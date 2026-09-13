// ChatStore: the per-account collection of conversations. Owns ingest
// routing (carbons, muc self-echo, corrections, reactions, markers) and
// MAM paging. The Conversation shape lives in conversation.svelte.ts,
// chat-state expiry in typing.ts, IndexedDB snapshots in
// persistence.svelte.ts.

import { SvelteMap, SvelteSet } from 'svelte/reactivity'

import { EPHEMERAL_SWEEP_MS, MESSAGE_PAGE_SIZE } from '$lib/constants'
import type { ChatConnection, MamPageResult } from '$lib/core/xmpp/connection'
import { SELF_BANNED_CODE, SELF_KICKED_CODE, SELF_RENAMED_CODE } from '$lib/core/xmpp/features/muc'
import type { Attachment, IncomingMessage, NotifySetting } from '$lib/core/xmpp/stanzas'
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
import {
  applyContentSignals,
  applyDeliverySignals,
  applyRetractionSignal,
  applyRoomRetraction,
  dropTombstone,
  findTombstone,
  mentionsSelf,
  mergeSelfEcho,
  routeMessage
} from './chats/signals'
import {
  canBuzz,
  hydrateConversation,
  isDuplicate,
  markDisplayedRemote,
  noteBuzz,
  saveMeta,
  sweepExpired
} from './chats/meta'
import {
  applyDeliveryError,
  clearConversation,
  correctStored,
  dropMessage,
  findIn,
  reactStored,
  retractStored
} from './chats/mutations'
import { ConversationPersistence } from './persistence.svelte'
import { TypingTracker } from './typing'

export type { Attachment }
export type {
  ChatMessage,
  Conversation,
  ConversationKind,
  RoomOccupant
} from './conversation.svelte'

export class ChatStore {
  conversations = new SvelteMap<string, Conversation>()
  // peers whose MAM archive we already pulled this session
  mamDone = new SvelteSet<string>()
  private loaded: Record<string, true> = {}
  // recent stanza/origin ids per peer for dedup. Internal bookkeeping,
  // no reactivity needed
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private seen = new Map<string, Set<string>>()
  private persistence: ConversationPersistence
  private typing = new TypingTracker()
  // fired once per live incoming message appended. Set by the app store,
  // consumed by the ui layer for notifications and aria-live announces
  onLive: ((peer: string, message: IncomingMessage, stored?: ChatMessage) => void) | undefined

  // options.persist=false is the untrusted-device path: conversations
  // stay in memory and never reach IndexedDB
  constructor(
    private readonly accountJid: string,
    options?: { persist?: boolean }
  ) {
    this.persistence = new ConversationPersistence(accountJid, options?.persist ?? true)
    // one interval services both periodic jobs: dropping expired
    // ephemeral messages and clearing stale real-time text buffers
    this.sweep = setInterval(() => this.sweepExpired(), EPHEMERAL_SWEEP_MS)
  }

  private readonly sweep: ReturnType<typeof setInterval>

  // called when the account is released. Flush() already ran at that
  // point so the interval can simply stop
  dispose(): void {
    clearInterval(this.sweep)
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
      void this.persistence.loadMeta(bare).then((meta) => {
        if (!meta) return
        if (meta.ephemeral !== undefined) conversation.ephemeralTimer = meta.ephemeral
        if (meta.notify !== undefined) conversation.notify = meta.notify
      })
    }
    return conversation
  }

  close(peerJid: string): void {
    const conversation = this.conversations.get(bareJid(peerJid))
    if (conversation) conversation.unread = 0
  }

  // persist any debounced writes. Called on disconnect and account removal
  flush(): Promise<void> {
    return this.persistence.flush()
  }

  // seenIds are the other aliases the same stanza can carry on the wire:
  // a live delivery has no stanza-id while its MAM copy adds the archive
  // id, so dedup must match on every candidate, not just the chosen key
  push(peerJid: string, message: ChatMessage, active = false, seenIds: string[] = []): boolean {
    const bare = bareJid(peerJid)
    const conversation = this.open(bare)
    if (isDuplicate(this.seen, bare, [message.id, ...seenIds])) return false
    // keep messages ordered by timestamp so archive pages and delayed
    // stanzas land in the right place instead of at the tail
    let at = conversation.messages.length
    while (at > 0 && (conversation.messages[at - 1]?.timestamp ?? 0) > message.timestamp) at--
    conversation.messages.splice(at, 0, message)
    // locally pushed messages (outgoing sends) pick up the negotiated
    // ephemeral timer too so they self-destruct like their wire copies
    if (
      message.expiresAt === undefined &&
      conversation.ephemeralTimer !== undefined &&
      conversation.ephemeralTimer > 0
    ) {
      message.expiresAt = message.timestamp + conversation.ephemeralTimer * 1000
    }
    if (!message.outgoing && !active) conversation.unread += 1
    this.persistence.schedule(conversation)
    return true
  }

  // find a stored message by wire id (what remote references in
  // reply/replace/reactions) or by our dedup id
  findMessage(peer: string, ref: string): ChatMessage | undefined {
    return findIn(this.conversations, peer, ref)
  }

  applyReaction(peer: string, sender: string, targetId: string, emojis: string[]): void {
    reactStored(this.conversations, peer, sender, targetId, emojis)
  }

  retract(peer: string, targetId: string): void {
    retractStored(this.conversations, this.persistence, peer, targetId)
  }

  clearHistory(peerJid: string): void {
    clearConversation(this.conversations, this.persistence, peerJid)
  }

  removeMessage(peer: string, id: string): void {
    dropMessage(this.conversations, this.persistence, peer, id)
  }

  applyCorrection(
    peer: string,
    replaceId: string,
    body: string,
    timestamp: number,
    spoilerHint?: string | undefined
  ): boolean {
    // keep original position but reflect the correction time for ordering
    void timestamp
    return correctStored(this.conversations, peer, replaceId, body, spoilerHint)
  }

  // Work out which conversation a stanza belongs to and whether it is ours.
  private routeMessage(message: IncomingMessage): { peer: string; outgoing: boolean } {
    return routeMessage(this.conversations, this.accountJid, message)
  }

  // Returns the stored message when the stanza produced one, undefined for
  // pure signal stanzas (receipts, chat states) and dedup hits.
  ingest(message: IncomingMessage, activePeer: string | null): ChatMessage | undefined {
    const { peer, outgoing } = this.routeMessage(message)

    const conversation = this.open(peer)
    if (message.type === 'groupchat') conversation.kind = 'muc'

    if (applyDeliveryError(this.conversations, this.persistence, conversation, peer, message)) {
      return undefined
    }

    // remember the peer's resource so feature probes (disco#info for
    // rtt and friends) target the client that is actually talking, not
    // the bare account
    if (!outgoing && message.type === 'chat' && message.from.includes('/')) {
      conversation.peerFullJid = message.from
    }

    const sender = message.type === 'groupchat' ? (message.nick ?? '') : bareJid(message.from)
    // XEP-0421: the stable occupant id keys reactions when the room
    // assigns one, so a rename does not split a sender's pills
    const reactionSender = message.type === 'groupchat' ? (message.occupantId ?? sender) : sender

    // XEP-0425: the room itself (never an occupant) announces that a
    // stanza-id was retracted. Tombstone the stored copy and drop the
    // notice so it never renders as a message.
    if (
      applyRoomRetraction(
        conversation,
        (p, r) => this.findMessage(p, r),
        this.persistence,
        peer,
        message
      )
    ) {
      return
    }

    // stanza-level metadata first so empty stanzas still update state
    applyDeliverySignals(
      peer,
      message,
      (p, id) => this.markDelivered(p, id),
      (p, r) => this.findMessage(p, r)
    )
    // XEP-0424 retraction and archive-tombstone handling. A consumed
    // stanza produces no row
    if (
      applyRetractionSignal(
        conversation,
        (p, r) => this.findMessage(p, r),
        this.persistence,
        peer,
        message,
        sender,
        outgoing
      ) === 'drop'
    ) {
      return
    }
    if (message.reactionTo) {
      this.applyReaction(peer, reactionSender, message.reactionTo.id, message.reactionTo.emojis)
    }
    applyContentSignals(this.typing, conversation, message, sender, outgoing, (c) =>
      this.saveMeta(c)
    )
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
    // tombstones carry no body. Store them so the placeholder renders
    if (
      !message.body &&
      !message.attachments?.length &&
      !message.undecryptable &&
      !message.retracted
    ) {
      // a bodiless buzz produced no row but still wants a notification
      if (message.attention && isLiveIncoming(message, outgoing)) {
        this.onLive?.(peer, message, undefined)
      }
      return undefined
    }

    // MUC self-echo: the room reflects our own message back with a fresh
    // stanza id. Merge it into the locally pushed copy (mark delivered,
    // adopt the stanza id) instead of showing the message twice.
    if (outgoing && mergeSelfEcho(conversation, message)) {
      return undefined
    }

    const fallbackId = `${peer}:${message.delay ?? ''}:${message.body}`
    const id = message.stanzaId ?? message.originId ?? fallbackId
    // the fallback is deliberately not an alias: it only dedups stanzas
    // that carry no id at all, where it becomes the chosen key. Keeping
    // it in seenIds would drop legit repeats of the same body that do
    // carry real ids.
    const seenIds = [message.stanzaId, message.originId, message.id].filter(
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
    if (message.geoloc) stored.geoloc = message.geoloc
    if (
      message.type === 'groupchat' &&
      !outgoing &&
      mentionsSelf(conversation, message, message.body)
    ) {
      stored.mentionsMe = true
    }
    // XEP-0466: the effective timer is the stanza's own if present, else
    // the negotiated conversation timer
    const timer = message.ephemeralTimer ?? conversation.ephemeralTimer
    if (timer !== undefined && timer > 0) stored.expiresAt = stored.timestamp + timer * 1000
    const appended = this.push(peer, stored, activePeer === peer, seenIds)
    // dedup drops return false. Only a truly appended live incoming
    // stanza notifies, so mam pages, delayed deliveries and our own
    // carbons never reach listeners
    if (appended && isLiveIncoming(message, outgoing)) {
      this.onLive?.(peer, message, stored)
    }
    return appended ? stored : undefined
  }

  private sweepExpired(): void {
    sweepExpired(this.conversations, this.persistence)
  }

  // XEP-0224 outgoing rate limit: one buzz per peer per window so a
  // tap-happy user cannot spam the stanza. Internal bookkeeping only,
  // never read by the ui - a plain map is fine.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private buzzedAt = new Map<string, number>()

  canBuzz(peer: string): boolean {
    return canBuzz(this.buzzedAt, peer)
  }

  noteBuzz(peer: string): void {
    noteBuzz(this.buzzedAt, peer)
  }

  // XEP-0466: change the local ephemeral timer and persist it. A timer
  // of 0 clears ephemeral mode.
  setEphemeral(peer: string, seconds: number): void {
    const conversation = this.open(peer)
    conversation.ephemeralTimer = seconds > 0 ? seconds : undefined
    this.saveMeta(conversation)
  }

  // XEP-0492: local notification override for a conversation.
  setNotify(peer: string, level: NotifySetting | undefined): void {
    const conversation = this.open(peer)
    conversation.notify = level
    this.saveMeta(conversation)
  }

  // XEP-0492: a bookmark sync carries the shared override. Unlike
  // setNotify this never opens a conversation: a bookmarked jid we have
  // no local history for must not materialize a sidebar row.
  applyRemoteNotify(peer: string, level: NotifySetting): void {
    const conversation = this.conversations.get(bareJid(peer))
    if (!conversation) return
    conversation.notify = level
    this.saveMeta(conversation)
  }

  private saveMeta(conversation: Conversation): void {
    saveMeta(this.persistence, conversation)
  }

  // XEP-0490: another of our resources displayed up to stanzaId in this
  // conversation, so nothing before it counts as unread here anymore.
  markDisplayedRemote(peer: string, stanzaId: string): void {
    markDisplayedRemote(this.conversations, this.persistence, peer, stanzaId)
  }

  // A stanza that failed to decrypt on arrival succeeded on retry: patch
  // its tombstone in place. Stanzas that carried only signals (reaction,
  // chat state, key transport) get their effect applied and the tombstone
  // removed instead.
  resolveDecrypted(message: IncomingMessage): boolean {
    const { peer } = this.routeMessage(message)
    const conversation = this.conversations.get(peer)
    if (!conversation) return false

    const stored = findTombstone(conversation, message, peer)
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
    dropTombstone(this.persistence, conversation, stored)
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
    // resource. Online presence gets no such fallback, or a stranger
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
        // nick. Adopt it so pending sends use it immediately
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

  private async hydrate(conversation: Conversation): Promise<void> {
    await hydrateConversation(this.persistence, this.seen, conversation)
  }
}
