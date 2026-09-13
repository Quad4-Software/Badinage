// Stanza signal application for ChatStore: receipts, markers, retractions,
// chat states, attention, rtt buffers, ephemeral timers and the muc
// self-echo merge. Free functions over the store's internals so
// chats.svelte.ts stays under the size gate. Behavior is identical.

import type { SvelteMap } from 'svelte/reactivity'

import type { IncomingMessage } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'
import { applyRttOps } from '$lib/utils/protocol/rtt'

import type { ConversationPersistence } from '../persistence.svelte'
import type { TypingTracker } from '../typing'
import type { ChatMessage, Conversation } from '../conversation.svelte'
import { applyRetraction } from '../messages'

// Work out which conversation a stanza belongs to and whether it is ours.
export function routeMessage(
  conversations: SvelteMap<string, Conversation>,
  accountJid: string,
  message: IncomingMessage
): { peer: string; outgoing: boolean } {
  if (message.carbon === 'sent') {
    return { peer: bareJid(message.to), outgoing: true }
  }
  if (message.type === 'groupchat') {
    const peer = bareJid(message.from)
    const room = conversations.get(peer)
    // nicks we held earlier still count as ours so a self-echo sent
    // before a rename still merges after it lands
    const outgoing =
      message.nick !== undefined &&
      (message.nick === room?.ourNick || (room?.ourNicks.has(message.nick) ?? false))
    return { peer, outgoing }
  }
  if (bareJid(message.from) === accountJid) {
    return { peer: bareJid(message.to), outgoing: true }
  }
  return { peer: bareJid(message.from), outgoing: false }
}

// XEP-0425: the room itself (never an occupant) announces that a
// stanza-id was retracted. Tombstone the stored copy and drop the
// notice so it never renders as a message. Returns true when the stanza
// was consumed.
export function applyRoomRetraction(
  conversation: Conversation,
  findMessage: (peer: string, ref: string) => ChatMessage | undefined,
  persistence: ConversationPersistence,
  peer: string,
  message: IncomingMessage
): boolean {
  if (!message.retraction) return false
  if (message.type === 'groupchat' && !message.nick) {
    const target = findMessage(peer, message.retraction.id)
    if (target) {
      target.retracted = true
      target.retractReason = message.retraction.reason
      target.body = ''
      target.attachments = undefined
      target.reactions = {}
      persistence.schedule(conversation)
    }
  }
  return true
}

// XEP-0424 / tombstone handling: a retraction names the message id to
// remove (the stanza id attribute in a dm, the room stanza-id in a muc).
// The fallback body must never render, even when no target matches.
// Returns 'drop' when the stanza is consumed, 'continue' otherwise.
export function applyRetractionSignal(
  conversation: Conversation,
  findMessage: (peer: string, ref: string) => ChatMessage | undefined,
  persistence: ConversationPersistence,
  peer: string,
  message: IncomingMessage,
  sender: string,
  outgoing: boolean
): 'drop' | 'continue' {
  if (message.retractId !== undefined) {
    const target = message.retractId === '' ? undefined : findMessage(peer, message.retractId)
    if (target) {
      // business rules: only the original author may retract. In a dm
      // that means the same side of the conversation. In a muc the
      // same nick, which stands in for the full jid in non-anonymous
      // rooms (occupant-id verification is not implemented).
      const sameSender =
        conversation.kind === 'muc' ? target.nick === sender : target.outgoing === outgoing
      if (sameSender) {
        applyRetraction(target)
        persistence.schedule(conversation)
      }
    }
    return 'drop'
  }
  // an archive tombstone is the original stanza with its contents
  // swapped for a retracted marker, so its own ids name the message it
  // replaced. Unknown targets are dropped without a row.
  if (message.retracted) {
    for (const ref of [message.stanzaId, message.id, message.originId]) {
      if (!ref) continue
      const target = findMessage(peer, ref)
      if (target) {
        applyRetraction(target)
        persistence.schedule(conversation)
        return 'drop'
      }
    }
    // no stored copy of the original: keep the tombstone itself as a
    // placeholder row
  }
  return 'continue'
}

// Delivery signals apply even to stanzas that carry no body, including
// retract notices, so they run before the retraction check.
export function applyDeliverySignals(
  peer: string,
  message: IncomingMessage,
  markDelivered: (peer: string, id: string) => void,
  findMessage: (peer: string, ref: string) => ChatMessage | undefined
): void {
  if (message.receiptFor) {
    markDelivered(peer, message.receiptFor)
  }
  const marker = message.marker
  if (marker) {
    const target = findMessage(peer, marker.id)
    if (target) {
      if (marker.type === 'received' || marker.type === 'acknowledged') {
        target.delivered = true
      }
      if (marker.type === 'displayed') {
        target.delivered = true
        target.read = true
      }
    }
  }
}

// Content signals: chat states, attention, rtt, ephemeral timers and
// subjects. Retraction stanzas are dropped before these run so their
// fallback payload cannot move any conversation state.
export function applyContentSignals(
  typing: TypingTracker,
  conversation: Conversation,
  message: IncomingMessage,
  sender: string,
  outgoing: boolean,
  saveMeta: (conversation: Conversation) => void
): void {
  if (message.chatState !== undefined && !outgoing) {
    // muc typers are tracked per nick in the typing tracker. PeerState
    // is the dm signal
    if (message.type !== 'groupchat') conversation.peerState = message.chatState
    typing.note(conversation, sender, message.chatState)
  }
  // XEP-0224: an attention stanza is a pure signal - flag the
  // conversation timestamp and let the ui decide how loud to be. The
  // stanza may also carry a body, so fall through to normal handling.
  // the live notification fires in ingest only when no row was appended
  // so a body-carrying buzz never notifies twice.
  if (message.attention && !outgoing) conversation.attentionAt = Date.now()
  // XEP-0301: apply real-time text ops into the per-sender buffer.
  // new/reset start a fresh buffer, edit extends it, cancel/init drop it.
  // An edit stanza may arrive out of order: its seq must exceed the last
  // applied one or the stale ops would corrupt the preview.
  if (message.rtt && !outgoing) {
    const key = message.type === 'groupchat' ? sender : ''
    if (message.rtt.event === 'cancel' || message.rtt.event === 'init') {
      conversation.liveText.delete(key)
    } else {
      const fresh = message.rtt.event === 'new' || message.rtt.event === 'reset'
      const last = conversation.liveText.get(key)
      const stale =
        !fresh &&
        message.rtt.seq !== undefined &&
        last?.seq !== undefined &&
        message.rtt.seq <= last.seq
      if (!stale) {
        const base = fresh ? '' : (last?.text ?? '')
        conversation.liveText.set(key, {
          text: applyRttOps(base, message.rtt.ops),
          at: Date.now(),
          seq: message.rtt.seq
        })
      }
    }
  }
  // XEP-0466: a peer-sent timer negotiates the conversation mode.
  // timer 0 disables it
  if (message.ephemeralTimer !== undefined && !outgoing) {
    conversation.ephemeralTimer = message.ephemeralTimer > 0 ? message.ephemeralTimer : undefined
    saveMeta(conversation)
  }
  // a content stanza implies the sender stopped composing
  if (!outgoing && message.body) {
    typing.clear(conversation, message.type === 'groupchat' ? sender : '')
    conversation.liveText.delete(message.type === 'groupchat' ? sender : '')
  }
  if (message.subject !== undefined) {
    conversation.subject = message.subject || undefined
  }
}

// MUC self-echo: the room reflects our own message back with a fresh
// stanza id. Merge it into the locally pushed copy (mark delivered,
// adopt the stanza id) instead of showing the message twice.
export function mergeSelfEcho(conversation: Conversation, message: IncomingMessage): boolean {
  if (!(message.type === 'groupchat' && !message.carbon)) return false
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const recent = conversation.messages[i]
    if (!recent || Date.now() - recent.timestamp > 60_000) break
    // the nick check pins the merge to the nick the message was
    // sent under, so echoes of older sends cannot misfire on a
    // same-body message sent after a rename
    if (
      recent.outgoing &&
      !recent.delivered &&
      recent.body === message.body &&
      recent.nick === message.nick
    ) {
      recent.delivered = true
      if (message.stanzaId) recent.id = message.stanzaId
      return true
    }
  }
  return false
}

// XEP-0372/0492: does an incoming muc message name us? Explicit
// mention references win. A bare nick mention still counts because
// many senders type @nick without producing references.
export function mentionsSelf(
  conversation: Conversation,
  message: IncomingMessage,
  body: string
): boolean {
  const nicks = [...conversation.ourNicks]
  if (conversation.ourNick) nicks.push(conversation.ourNick)
  if (nicks.length === 0) return false
  for (const ref of message.references ?? []) {
    if (ref.type !== 'mention') continue
    const begin = ref.begin ?? 0
    const end = ref.end ?? [...body].length
    const range = [...body].slice(begin, end).join('')
    const uri = ref.uri ?? ''
    for (const nick of nicks) {
      if (range.toLowerCase().includes(nick.toLowerCase())) return true
      if (uri.toLowerCase() === `xmpp:${conversation.peerJid}/${nick}`.toLowerCase()) {
        return true
      }
    }
  }
  for (const nick of nicks) {
    const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, 'iu')
    if (re.test(body)) return true
  }
  return false
}

// Find the undecryptable tombstone a retried stanza belongs to. The
// tombstone was stored with an empty body, so its fallback id had an
// empty body component too.
export function findTombstone(
  conversation: Conversation,
  message: IncomingMessage,
  peer: string
): ChatMessage | undefined {
  const tombstoneFallback = `${peer}:${message.delay ?? ''}:`
  return conversation.messages.find(
    (m) =>
      m.undecryptable === true &&
      ((message.stanzaId !== undefined && m.id === message.stanzaId) ||
        (message.originId !== undefined && m.id === message.originId) ||
        (message.id !== undefined && m.wireId === message.id) ||
        m.id === tombstoneFallback)
  )
}

// Remove a tombstone row and keep the unread counter truthful.
export function dropTombstone(
  persistence: ConversationPersistence,
  conversation: Conversation,
  stored: ChatMessage
): void {
  const at = conversation.messages.indexOf(stored)
  if (at < 0) return
  conversation.messages.splice(at, 1)
  if (!stored.outgoing && conversation.unread > 0) conversation.unread -= 1
  persistence.schedule(conversation)
}
