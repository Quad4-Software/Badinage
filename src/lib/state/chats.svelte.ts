// ChatStore: the per-account collection of conversations. Owns ingest
// routing (carbons, muc self-echo, corrections, reactions, markers) and
// MAM paging. The Conversation shape lives in conversation.svelte.ts,
// chat-state expiry in typing.ts, IndexedDB snapshots in
// persistence.svelte.ts.

import { SvelteMap, SvelteSet } from 'svelte/reactivity'

import { MESSAGE_PAGE_SIZE } from '$lib/constants'
import type { ChatConnection, MamPageResult } from '$lib/core/xmpp/connection'
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
import { applyCorrection, applyReactions } from './messages'
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

  applyCorrection(peer: string, replaceId: string, body: string, timestamp: number): boolean {
    const target = this.findMessage(peer, replaceId)
    if (!target) return false
    // keep original position but reflect the correction time for ordering
    void timestamp
    applyCorrection(target, body)
    return true
  }

  ingest(message: IncomingMessage, activePeer: string | null): void {
    // Work out which conversation this stanza belongs to and whether it is ours.
    let peer: string
    let outgoing = false
    if (message.carbon === 'sent') {
      peer = bareJid(message.to)
      outgoing = true
    } else if (message.type === 'groupchat') {
      peer = bareJid(message.from)
      const ownNick = this.conversations.get(peer)?.ourNick
      outgoing = message.nick !== undefined && message.nick === ownNick
    } else if (bareJid(message.from) === this.accountJid) {
      peer = bareJid(message.to)
      outgoing = true
    } else {
      peer = bareJid(message.from)
    }

    const conversation = this.open(peer)
    if (message.type === 'groupchat') conversation.kind = 'muc'

    const sender = message.type === 'groupchat' ? (message.nick ?? '') : bareJid(message.from)

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
    if (message.reactionTo) {
      this.applyReaction(peer, sender, message.reactionTo.id, message.reactionTo.emojis)
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
        this.applyCorrection(peer, message.replaceId, message.body, message.delay ?? Date.now())
      ) {
        return
      }
      // target unknown: fall through and show it as a normal message
    }
    if (message.encrypted && conversation.kind === 'dm') conversation.encrypted = true
    if (!message.body && !message.attachments?.length && !message.undecryptable) return

    // MUC self-echo: the room reflects our own message back with a fresh
    // stanza id. Merge it into the locally pushed copy (mark delivered,
    // adopt the stanza id) instead of showing the message twice.
    if (outgoing && message.type === 'groupchat' && !message.carbon) {
      for (let i = conversation.messages.length - 1; i >= 0; i--) {
        const recent = conversation.messages[i]
        if (!recent || Date.now() - recent.timestamp > 60_000) break
        if (recent.outgoing && !recent.delivered && recent.body === message.body) {
          recent.delivered = true
          if (message.stanzaId) recent.id = message.stanzaId
          return
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
    if (message.replyTo) stored.replyTo = message.replyTo
    if (message.attachments?.length) stored.attachments = message.attachments
    if (message.signed) stored.signed = true
    if (message.encrypted) stored.encrypted = true
    if (message.undecryptable) stored.undecryptable = true
    if (message.untrustedDevice) stored.untrustedDevice = true
    const appended = this.push(peer, stored, activePeer === peer, seenIds)
    // dedup drops return false; only a truly appended live incoming
    // stanza notifies, so mam pages, delayed deliveries and our own
    // carbons never reach listeners
    if (appended && isLiveIncoming(message, outgoing)) this.onLive?.(peer, message)
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

  setOccupant(room: string, occupant: RoomOccupant): void {
    const conversation = this.open(room, 'muc')
    if (occupant.presence === 'offline') {
      conversation.occupants.delete(occupant.nick)
    } else {
      conversation.occupants.set(occupant.nick, occupant)
    }
    if (occupant.self) {
      conversation.joined = occupant.presence !== 'offline'
      conversation.ourNick = occupant.nick
    }
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
      batch.push(raw)
      if (seen.size < DEDUP_CAP) seen.add(raw.id)
    }
    // one splice so reactivity notifies once for the whole batch
    conversation.messages.splice(0, 0, ...batch)
  }
}
