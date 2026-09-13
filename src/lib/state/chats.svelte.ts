// ChatStore: the per-account collection of conversations. Owns ingest
// routing (carbons, muc self-echo, corrections, reactions, markers) and
// MAM paging. The Conversation shape lives in conversation.svelte.ts,
// chat-state expiry in typing.ts, IndexedDB snapshots in
// persistence.svelte.ts.

import { SvelteMap, SvelteSet } from 'svelte/reactivity'

import { MESSAGE_PAGE_SIZE } from '$lib/constants'
import type { ChatConnection, MamPageResult } from '$lib/core/xmpp/connection'
import { SELF_BANNED_CODE, SELF_KICKED_CODE, SELF_RENAMED_CODE } from '$lib/core/xmpp/features/muc'
import type { Attachment, IncomingMessage } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'
import { isLiveIncoming } from '$lib/utils/notify'

import {
  createConversation,
  emptyMessage,
  type ChatMessage,
  type Conversation,
  type ConversationKind,
  type RoomOccupant
} from './conversation.svelte'
import { applyCorrection, applyReactions, applyRetraction } from './messages'
import { ConversationPersistence } from './persistence.svelte'
import { TypingTracker } from './typing'

export type { Attachment }
export type {
  ChatMessage,
  Conversation,
  ConversationKind,
  RoomOccupant
} from './conversation.svelte'

const DEDUP_CAP = 500

export class ChatStore {
  conversations = new SvelteMap<string, Conversation>()
  // peers whose MAM archive we already pulled this session
  mamDone = new SvelteSet<string>()
  private loaded: Record<string, true> = {}
  // recent stanza/origin ids per peer for dedup; internal bookkeeping,
  // no reactivity needed
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private seen = new Map<string, Set<string>>()
  private persistence: ConversationPersistence
  private typing = new TypingTracker()
  // fired once per live incoming message appended; set by the app store,
  // consumed by the ui layer for notifications and aria-live announces
  onLive: ((peer: string, message: IncomingMessage) => void) | undefined

  // options.persist=false is the untrusted-device path: conversations
  // stay in memory and never reach IndexedDB
  constructor(
    private readonly accountJid: string,
    options?: { persist?: boolean }
  ) {
    this.persistence = new ConversationPersistence(accountJid, options?.persist ?? true)
  }

  open(peerJid: string, kind: ConversationKind = 'dm'): Conversation {
    const bare = bareJid(peerJid)
    let conversation = this.conversations.get(bare)
    if (!conversation) {
      conversation = createConversation(bare, kind)
      this.conversations.set(bare, conversation)
    }
    if (kind === 'muc') conversation.kind = 'muc'
    if (!this.loaded[bare]) {
      this.loaded[bare] = true
      void this.hydrate(conversation)
    }
    return conversation
  }

  close(peerJid: string): void {
    const conversation = this.conversations.get(bareJid(peerJid))
    if (conversation) conversation.unread = 0
  }

  // persist any debounced writes; called on disconnect and account removal
  flush(): Promise<void> {
    return this.persistence.flush()
  }

  // seenIds are the other aliases the same stanza can carry on the wire:
  // a live delivery has no stanza-id while its MAM copy adds the archive
  // id, so dedup must match on every candidate, not just the chosen key
  push(peerJid: string, message: ChatMessage, active = false, seenIds: string[] = []): boolean {
    const bare = bareJid(peerJid)
    const conversation = this.open(bare)
    if (this.isDuplicate(bare, [message.id, ...seenIds])) return false
    // keep messages ordered by timestamp so archive pages and delayed
    // stanzas land in the right place instead of at the tail
    let at = conversation.messages.length
    while (at > 0 && (conversation.messages[at - 1]?.timestamp ?? 0) > message.timestamp) at--
    conversation.messages.splice(at, 0, message)
    if (!message.outgoing && !active) conversation.unread += 1
    this.persistence.schedule(conversation)
    return true
  }

  // find a stored message by wire id (what remote references in
  // reply/replace/reactions) or by our dedup id
  findMessage(peer: string, ref: string): ChatMessage | undefined {
    const messages = this.conversations.get(bareJid(peer))?.messages
    return messages?.find((m) => m.wireId === ref || m.id === ref)
  }

  applyReaction(peer: string, sender: string, targetId: string, emojis: string[]): void {
    const target = this.findMessage(peer, targetId)
    if (target) applyReactions(target, sender, emojis)
  }

  // Optimistic local apply for a retraction we just sent ourselves; the
  // wire-side sender check is unnecessary here.
  retract(peer: string, targetId: string): void {
    const target = this.findMessage(peer, targetId)
    if (!target) return
    applyRetraction(target)
    const conversation = this.conversations.get(bareJid(peer))
    if (conversation) this.persistence.schedule(conversation)
  }

  // Drop a message row outright. Used for pending uploads that get
  // cancelled or fail: nothing reached the wire, so no tombstone.
  removeMessage(peer: string, id: string): void {
    const conversation = this.conversations.get(bareJid(peer))
    if (!conversation) return
    const index = conversation.messages.findIndex((m) => m.id === id)
    if (index === -1) return
    conversation.messages.splice(index, 1)
    this.persistence.schedule(conversation)
  }

  applyCorrection(
    peer: string,
    replaceId: string,
    body: string,
    timestamp: number,
    spoilerHint?: string | undefined
  ): boolean {
    const target = this.findMessage(peer, replaceId)
    if (!target) return false
    // keep original position but reflect the correction time for ordering
    void timestamp
    applyCorrection(target, body, spoilerHint)
    return true
  }

  // Work out which conversation a stanza belongs to and whether it is ours.
  private routeMessage(message: IncomingMessage): { peer: string; outgoing: boolean } {
    if (message.carbon === 'sent') {
      return { peer: bareJid(message.to), outgoing: true }
    }
    if (message.type === 'groupchat') {
      const peer = bareJid(message.from)
      const room = this.conversations.get(peer)
      // nicks we held earlier still count as ours so a self-echo sent
      // before a rename still merges after it lands
      const outgoing =
        message.nick !== undefined &&
        (message.nick === room?.ourNick || (room?.ourNicks.has(message.nick) ?? false))
      return { peer, outgoing }
    }
    if (bareJid(message.from) === this.accountJid) {
      return { peer: bareJid(message.to), outgoing: true }
    }
    return { peer: bareJid(message.from), outgoing: false }
  }

  // Returns the stored message when the stanza produced one, undefined for
  // pure signal stanzas (receipts, chat states) and dedup hits.
  ingest(message: IncomingMessage, activePeer: string | null): ChatMessage | undefined {
    const { peer, outgoing } = this.routeMessage(message)

    const conversation = this.open(peer)
    if (message.type === 'groupchat') conversation.kind = 'muc'

    const sender = message.type === 'groupchat' ? (message.nick ?? '') : bareJid(message.from)
    // XEP-0421: the stable occupant id keys reactions when the room
    // assigns one, so a rename does not split a sender's pills
    const reactionSender = message.type === 'groupchat' ? (message.occupantId ?? sender) : sender

    // XEP-0425: the room itself (never an occupant) announces that a
    // stanza-id was retracted. Tombstone the stored copy and drop the
    // notice so it never renders as a message.
    if (message.retraction) {
      if (message.type === 'groupchat' && !message.nick) {
        const target = this.findMessage(peer, message.retraction.id)
        if (target) {
          target.retracted = true
          target.retractReason = message.retraction.reason
          target.body = ''
          target.attachments = undefined
          target.reactions = {}
          this.persistence.schedule(conversation)
        }
      }
      return
    }

    // stanza-level metadata first so empty stanzas still update state
    if (message.receiptFor) {
      this.markDelivered(peer, message.receiptFor)
    }
    const marker = message.marker
    if (marker) {
      const target = this.findMessage(peer, marker.id)
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
    // XEP-0424: a retraction names the message id to remove (the stanza
    // id attribute in a dm, the room stanza-id in a muc). The fallback
    // body must never render, even when no target matches.
    if (message.retractId !== undefined) {
      const target =
        message.retractId === '' ? undefined : this.findMessage(peer, message.retractId)
      if (target) {
        // business rules: only the original author may retract. In a dm
        // that means the same side of the conversation; in a muc the
        // same nick, which stands in for the full jid in non-anonymous
        // rooms (occupant-id verification is not implemented).
        const sameSender =
          conversation.kind === 'muc' ? target.nick === sender : target.outgoing === outgoing
        if (sameSender) {
          applyRetraction(target)
          this.persistence.schedule(conversation)
        }
      }
      return
    }
    // an archive tombstone is the original stanza with its contents
    // swapped for a retracted marker, so its own ids name the message it
    // replaced. Unknown targets are dropped without a row.
    if (message.retracted) {
      for (const ref of [message.stanzaId, message.id, message.originId]) {
        if (!ref) continue
        const target = this.findMessage(peer, ref)
        if (target) {
          applyRetraction(target)
          this.persistence.schedule(conversation)
          return
        }
      }
      // no stored copy of the original: fall through and keep the
      // tombstone itself as a placeholder row
    }
    if (message.reactionTo) {
      this.applyReaction(peer, reactionSender, message.reactionTo.id, message.reactionTo.emojis)
    }
    if (message.chatState !== undefined && !outgoing) {
      // muc typers are tracked per nick in the typing tracker; peerState
      // is the dm signal
      if (message.type !== 'groupchat') conversation.peerState = message.chatState
      this.typing.note(conversation, sender, message.chatState)
    }
    // a content stanza implies the sender stopped composing
    if (!outgoing && message.body) {
      this.typing.clear(conversation, message.type === 'groupchat' ? sender : '')
    }
    if (message.subject !== undefined) {
      conversation.subject = message.subject || undefined
    }
    // corrections replace an existing message instead of appending
    if (message.replaceId && message.body) {
      if (
        this.applyCorrection(
          peer,
          message.replaceId,
          message.body,
          message.delay ?? Date.now(),
          message.spoilerHint
        )
      ) {
        return undefined
      }
      // target unknown: fall through and show it as a normal message
    }
    if (message.encrypted && conversation.kind === 'dm') conversation.encrypted = true
    // tombstones carry no body; store them so the placeholder renders
    if (
      !message.body &&
      !message.attachments?.length &&
      !message.undecryptable &&
      !message.retracted
    )
      return undefined

    // MUC self-echo: the room reflects our own message back with a fresh
    // stanza id. Merge it into the locally pushed copy (mark delivered,
    // adopt the stanza id) instead of showing the message twice.
    if (outgoing && message.type === 'groupchat' && !message.carbon) {
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
          return undefined
        }
      }
    }

    const fallbackId = `${peer}:${message.delay ?? ''}:${message.body}`
    const id = message.stanzaId ?? message.originId ?? fallbackId
    const seenIds = [message.stanzaId, message.originId, message.id, fallbackId].filter(
      (candidate): candidate is string => candidate !== undefined && candidate !== id
    )
    const stored: ChatMessage = {
      ...emptyMessage(peer),
      id,
      wireId: message.id,
      body: message.body,
      outgoing,
      timestamp: message.delay ?? Date.now(),
      delivered: outgoing ? message.carbon === 'sent' : false,
      nick: message.type === 'groupchat' ? message.nick : undefined
    }
    if (message.type === 'groupchat' && message.occupantId) {
      stored.occupantId = message.occupantId
    }
    if (message.retracted) {
      stored.retracted = true
      stored.retractReason = message.retracted.reason
    }
    if (message.replyTo) stored.replyTo = message.replyTo
    if (message.attachments?.length) stored.attachments = message.attachments
    if (message.spoilerHint !== undefined) stored.spoilerHint = message.spoilerHint
    if (message.unstyled) stored.unstyled = true
    if (message.signed) stored.signed = true
    if (message.encrypted) stored.encrypted = true
    if (message.undecryptable) stored.undecryptable = true
    if (message.untrustedDevice) stored.untrustedDevice = true
    const appended = this.push(peer, stored, activePeer === peer, seenIds)
    // dedup drops return false; only a truly appended live incoming
    // stanza notifies, so mam pages, delayed deliveries and our own
    // carbons never reach listeners
    if (appended && isLiveIncoming(message, outgoing)) this.onLive?.(peer, message)
    return appended ? stored : undefined
  }

  // A stanza that failed to decrypt on arrival succeeded on retry: patch
  // its tombstone in place. Stanzas that carried only signals (reaction,
  // chat state, key transport) get their effect applied and the tombstone
  // removed instead.
  resolveDecrypted(message: IncomingMessage): boolean {
    const { peer } = this.routeMessage(message)
    const conversation = this.conversations.get(peer)
    if (!conversation) return false

    // the tombstone was stored with an empty body, so its fallback id had
    // an empty body component too
    const tombstoneFallback = `${peer}:${message.delay ?? ''}:`
    const stored = conversation.messages.find(
      (m) =>
        m.undecryptable === true &&
        ((message.stanzaId !== undefined && m.id === message.stanzaId) ||
          (message.originId !== undefined && m.id === message.originId) ||
          (message.id !== undefined && m.wireId === message.id) ||
          m.id === tombstoneFallback)
    )
    if (!stored) return false

    const sender = message.type === 'groupchat' ? (message.nick ?? '') : bareJid(message.from)
    if (message.reactionTo) {
      this.applyReaction(peer, sender, message.reactionTo.id, message.reactionTo.emojis)
    }
    if (message.chatState !== undefined && conversation.kind === 'dm') {
      conversation.peerState = message.chatState
    }
    if (message.replaceId && message.body) {
      if (this.applyCorrection(peer, message.replaceId, message.body, Date.now())) {
        this.dropTombstone(conversation, stored)
        return true
      }
    }
    if (!message.body && !message.attachments?.length) {
      this.dropTombstone(conversation, stored)
      return true
    }
    stored.body = message.body
    delete stored.undecryptable
    delete stored.keyRequested
    stored.encrypted = true
    if (message.untrustedDevice) stored.untrustedDevice = true
    if (message.replyTo) stored.replyTo = message.replyTo
    if (message.attachments?.length) stored.attachments = message.attachments
    return true
  }

  private dropTombstone(conversation: Conversation, stored: ChatMessage): void {
    const at = conversation.messages.indexOf(stored)
    if (at < 0) return
    conversation.messages.splice(at, 1)
    if (!stored.outgoing && conversation.unread > 0) conversation.unread -= 1
    this.persistence.schedule(conversation)
  }

  // Remove one stored message by its display id. The UI uses this to
  // dismiss undecryptable tombstones that will never resolve.
  dropMessage(peer: string, id: string): void {
    const conversation = this.conversations.get(bareJid(peer))
    const stored = conversation?.messages.find((m) => m.id === id)
    if (!conversation || !stored) return
    this.dropTombstone(conversation, stored)
  }

  markDelivered(peerJid: string, id: string): void {
    const message = this.findMessage(peerJid, id)
    if (message) message.delivered = true
  }

  // Record the rsm cursor from a finished archive page. The archive is
  // treated as exhausted when the fin says complete or the page carried
  // no first uid to page before.
  noteHistoryPage(conversation: Conversation, result: MamPageResult): void {
    conversation.historyCursor = result.first
    conversation.historyComplete = result.complete || !result.first
  }

  // Fetch the next older archive page. No-ops while a page is in flight
  // or once the archive is exhausted. With no cursor yet the server
  // returns its latest page, which is what the initial selectPeer fetch
  // uses too.
  loadOlder(conversation: Conversation, connection: ChatConnection): void {
    if (!connection.connected) return
    if (conversation.historyLoading || conversation.historyComplete) return
    conversation.historyLoading = true
    connection.queryArchive(
      conversation.peerJid,
      {
        max: MESSAGE_PAGE_SIZE,
        before: conversation.historyCursor,
        room: conversation.kind === 'muc'
      },
      (result) => {
        this.noteHistoryPage(conversation, result)
        conversation.historyLoading = false
      }
    )
  }

  // remember join parameters so the rejoin watchdog can replay them and
  // retry banners can re-send them without asking again
  noteJoin(room: string, nick: string, password?: string): void {
    const conversation = this.open(room, 'muc')
    conversation.ourNick = nick
    conversation.ourNicks.add(nick)
    conversation.password = password
    conversation.joinError = undefined
    conversation.kicked = false
    conversation.kickReason = undefined
    conversation.banned = false
  }

  setOccupant(room: string, occupant: RoomOccupant): void {
    const conversation = this.open(room, 'muc')
    const renamed = occupant.codes.includes(SELF_RENAMED_CODE)
    // offline stanzas without a 110 still leave our nick in the from
    // resource; online presence gets no such fallback, or a stranger
    // taking our nick after a kick would mark us joined
    const self =
      occupant.self || (occupant.presence === 'offline' && occupant.nick === conversation.ourNick)
    if (occupant.presence === 'offline') {
      conversation.occupants.delete(occupant.nick)
      conversation.typers.delete(occupant.nick)
    } else {
      conversation.occupants.set(occupant.nick, occupant)
    }
    if (!self) return
    if (occupant.presence === 'offline') {
      if (renamed && occupant.newNick) {
        // the departing half of a nick change already names the new
        // nick; adopt it so pending sends use it immediately
        conversation.ourNick = occupant.newNick
        conversation.ourNicks.add(occupant.newNick)
        return
      }
      conversation.joined = false
      if (occupant.codes.includes(SELF_BANNED_CODE)) {
        conversation.banned = true
        conversation.kicked = false
      } else if (occupant.codes.includes(SELF_KICKED_CODE)) {
        conversation.kicked = true
        conversation.kickReason = occupant.reason
      }
      return
    }
    conversation.joined = true
    conversation.joinError = undefined
    conversation.kicked = false
    conversation.kickReason = undefined
    conversation.banned = false
    conversation.ourNick = occupant.nick
    conversation.ourNicks.add(occupant.nick)
    if (occupant.occupantId) conversation.ourOccupantId = occupant.occupantId
  }

  private isDuplicate(peer: string, ids: string[]): boolean {
    let set = this.seen.get(peer)
    if (!set) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      set = new Set()
      this.seen.set(peer, set)
    }
    if (ids.some((id) => set.has(id))) return true
    for (const id of ids) set.add(id)
    if (set.size > DEDUP_CAP) {
      // drop the oldest entries; Set iterates in insertion order
      for (const old of set) {
        if (set.size <= DEDUP_CAP) break
        set.delete(old)
      }
    }
    return false
  }

  private async hydrate(conversation: Conversation): Promise<void> {
    const stored = await this.persistence.load(conversation.peerJid)
    if (!stored || conversation.messages.length > 0) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = this.seen.get(conversation.peerJid) ?? new Set<string>()
    this.seen.set(conversation.peerJid, seen)
    const batch: ChatMessage[] = []
    for (const raw of stored) {
      // older caches lack newer fields
      raw.reactions ??= {}
      // a still-pending upload left no wire trace, drop the zombie row
      if (raw.pending) continue
      batch.push(raw)
      if (seen.size < DEDUP_CAP) seen.add(raw.id)
    }
    // one splice so reactivity notifies once for the whole batch
    conversation.messages.splice(0, 0, ...batch)
  }
}
