import { SvelteMap, SvelteSet } from 'svelte/reactivity'

import { MESSAGE_PAGE_SIZE } from '$lib/constants'
import { idb } from '$lib/core/storage/idb'
import { scopedKey } from '$lib/core/storage/keys'
import type { Attachment, ChatState, IncomingMessage } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

export type { Attachment }

export type ConversationKind = 'dm' | 'muc'

export interface ReplyRef {
  id: string
  from: string
  quote?: string | undefined
}

export interface ChatMessage {
  // dedup key: stanza-id when present, else origin-id, else a fallback
  id: string
  // the stanza's wire id attribute - used for receipts and chat markers
  wireId?: string | undefined
  peerJid: string
  body: string
  outgoing: boolean
  timestamp: number
  encrypted: boolean
  delivered: boolean
  read: boolean
  nick?: string | undefined
  replyTo?: ReplyRef | undefined
  attachments?: Attachment[] | undefined
  // emoji -> list of senders (bare jids for dms, nicks for muc)
  reactions: Record<string, string[]>
  edited?: boolean
  // signing state placeholder: 'signed' once verification lands
  signed?: boolean
}

export interface RoomOccupant {
  nick: string
  presence: string
  affiliation: string
  role: string
  self: boolean
}

export interface Conversation {
  peerJid: string
  kind: ConversationKind
  messages: ChatMessage[]
  unread: number
  // typing indicator state of the peer (dm) - composing etc.
  peerState?: ChatState | undefined
  // muc only
  subject?: string | undefined
  occupants: SvelteMap<string, RoomOccupant>
  ourNick?: string | undefined
  joined?: boolean
}

const RETAINED_MESSAGES = MESSAGE_PAGE_SIZE * 4
const DEDUP_CAP = 500

export function emptyMessage(peerJid: string): ChatMessage {
  return {
    id: '',
    peerJid,
    body: '',
    outgoing: true,
    timestamp: Date.now(),
    encrypted: false,
    delivered: false,
    read: false,
    reactions: {}
  }
}

export class ChatStore {
  conversations = new SvelteMap<string, Conversation>()
  // peers whose MAM archive we already pulled this session
  mamDone = new SvelteSet<string>()
  private loaded: Record<string, true> = {}
  // recent stanza/origin ids per peer for dedup
  private seen = new SvelteMap<string, string[]>()

  constructor(private readonly accountJid: string) {}

  open(peerJid: string, kind: ConversationKind = 'dm'): Conversation {
    const bare = bareJid(peerJid)
    let conversation = this.conversations.get(bare)
    if (!conversation) {
      // $state so fields like unread and peerState stay reactive inside the map
      const created = $state<Conversation>({
        peerJid: bare,
        kind,
        messages: [],
        unread: 0,
        occupants: new SvelteMap()
      })
      this.conversations.set(bare, created)
      conversation = created
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

  push(peerJid: string, message: ChatMessage, active = false): boolean {
    const bare = bareJid(peerJid)
    const conversation = this.open(bare)
    if (this.isDuplicate(bare, message.id)) return false
    // keep messages ordered by timestamp so archive pages and delayed
    // stanzas land in the right place instead of at the tail
    let at = conversation.messages.length
    while (at > 0 && (conversation.messages[at - 1]?.timestamp ?? 0) > message.timestamp) at--
    conversation.messages.splice(at, 0, message)
    if (!message.outgoing && !active) conversation.unread += 1
    void this.persist(conversation)
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
    if (!target) return
    // each sender's new reaction set replaces their previous one
    for (const [emoji, senders] of Object.entries(target.reactions)) {
      const next = senders.filter((s) => s !== sender)
      target.reactions[emoji] = next
    }
    // drop empty sets afterwards to keep reactions reactive
    for (const [emoji, senders] of Object.entries(target.reactions)) {
      if (senders.length === 0) {
        const { [emoji]: _gone, ...rest } = target.reactions
        void _gone
        target.reactions = rest
      }
    }
    for (const emoji of emojis) {
      const senders = target.reactions[emoji] ?? []
      if (!senders.includes(sender)) senders.push(sender)
      target.reactions[emoji] = senders
    }
  }

  applyCorrection(peer: string, replaceId: string, body: string, timestamp: number): boolean {
    const target = this.findMessage(peer, replaceId)
    if (!target) return false
    target.body = body
    target.edited = true
    // keep original position but reflect the correction time for ordering
    void timestamp
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
      conversation.peerState = message.chatState
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
    if (!message.body && !message.attachments?.length) return

    const id =
      message.stanzaId ?? message.originId ?? `${peer}:${message.delay ?? ''}:${message.body}`
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
    this.push(peer, stored, activePeer === peer)
  }

  markDelivered(peerJid: string, id: string): void {
    const message = this.findMessage(peerJid, id)
    if (message) message.delivered = true
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

  private isDuplicate(peer: string, id: string): boolean {
    let list = this.seen.get(peer)
    if (!list) {
      list = []
      this.seen.set(peer, list)
    }
    if (list.includes(id)) return true
    list.push(id)
    if (list.length > DEDUP_CAP) list.splice(0, list.length - DEDUP_CAP)
    return false
  }

  private storageKey(peerJid: string): string {
    return scopedKey(this.accountJid, 'msgs', bareJid(peerJid))
  }

  private async hydrate(conversation: Conversation): Promise<void> {
    const stored = await idb.get<ChatMessage[]>('messages', this.storageKey(conversation.peerJid))
    if (!stored || conversation.messages.length > 0) return
    for (const raw of stored) {
      // older caches lack newer fields
      raw.reactions ??= {}
      conversation.messages.push(raw)
      let list = this.seen.get(conversation.peerJid)
      if (!list) {
        list = []
        this.seen.set(conversation.peerJid, list)
      }
      if (list.length < DEDUP_CAP) list.push(raw.id)
    }
  }

  private async persist(conversation: Conversation): Promise<void> {
    // $state proxies cannot be structured-cloned, snapshot to plain data
    const retained = $state.snapshot(conversation.messages.slice(-RETAINED_MESSAGES))
    await idb.set('messages', this.storageKey(conversation.peerJid), retained)
  }
}
