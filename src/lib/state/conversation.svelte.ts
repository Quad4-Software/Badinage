// Conversation model: the message list, unread counter, chat states and
// MUC room metadata for one peer. Pure data plus a reactive factory.
// mutation lives in ChatStore (chats.svelte.ts).

import { SvelteMap, SvelteSet } from 'svelte/reactivity'

import type { Attachment, ChatState, Geoloc, NotifySetting } from '$lib/core/xmpp/stanzas'

export type ConversationKind = 'dm' | 'muc'

interface ReplyRef {
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
  // XEP-0421 stable sender id on groupchat messages. Reaction sender
  // keys prefer it over the nick so renames do not split reactions
  occupantId?: string | undefined
  // XEP-0424/0425 tombstone: the message was retracted, optionally with
  // a reason given by the moderator. Body, attachments and reactions are
  // cleared but the row stays so replies still anchor
  retracted?: boolean | undefined
  retractReason?: string | undefined
  // decryption failed or the stanza could not be shown as text
  undecryptable?: boolean | undefined
  // we sent the sender's device a key transport asking it to repair the
  // session (XEP-0384 recovery). Purely informational for the tombstone
  keyRequested?: boolean | undefined
  // decrypted, but the sending device is distrusted or changed keys
  untrustedDevice?: boolean | undefined
  replyTo?: ReplyRef | undefined
  attachments?: Attachment[] | undefined
  // emoji -> list of senders (bare jids for dms, nicks for muc)
  reactions: Record<string, string[]>
  edited?: boolean
  // signing state placeholder: 'signed' once verification lands
  signed?: boolean
  // XEP-0382: the body is a spoiler hidden behind a reveal control. The
  // string is the sender's optional hint, empty for a hintless spoiler
  spoilerHint?: string | undefined
  // XEP-0393: the sender asked for the body to render unstyled
  unstyled?: boolean | undefined
  // local-only upload state for an outgoing attachment that is still in
  // flight. Never persists meaningfully across restarts
  pending?: boolean | undefined
  // 0..1 upload progress while pending
  uploadProgress?: number | undefined
  // file name shown on the pending upload row
  pendingName?: string | undefined
  // XEP-0466: epoch ms when this message self-destructs. Computed at
  // ingest from the conversation's ephemeral timer
  expiresAt?: number | undefined
  // XEP-0080 location payload carried by the stanza
  geoloc?: Geoloc | undefined
  // XEP-0372/0492: this muc message names us via a mention reference or
  // a bare nick hit. Drives highlight and on-mention notifications
  mentionsMe?: boolean | undefined
  // stanza type=error bounce: the server or peer refused delivery. Holds
  // the RFC 6120 condition (service-unavailable, remote-server-timeout...)
  deliveryError?: string | undefined
}

export interface RoomOccupant {
  nick: string
  presence: string
  affiliation: string
  role: string
  self: boolean
  // muc#user status codes seen on the latest presence for this occupant
  codes: string[]
  // real jid, exposed only by non-anonymous rooms
  jid?: string | undefined
  // XEP-0421 stable id
  occupantId?: string | undefined
  // item nick attribute on a 303 nick-change broadcast
  newNick?: string | undefined
  // kick or ban reason when the room sent one
  reason?: string | undefined
}

// A MUC join failure surfaced to the ui: the RFC 6120 code and the
// stanza error condition, plus any human readable text.
export interface JoinError {
  code?: string | undefined
  condition?: string | undefined
  text?: string | undefined
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
  // muc: nicks currently composing, kept separate from peerState so
  // several members can show as typing at once
  typers: SvelteSet<string>
  ourNick?: string | undefined
  // every nick we have held in this room, so a late self-echo still
  // merges after a rename
  ourNicks: SvelteSet<string>
  // our own XEP-0421 id when the room assigns one
  ourOccupantId?: string | undefined
  // room password remembered for rejoins
  password?: string | undefined
  // last join failure, shown as a banner with retry affordances
  joinError?: JoinError | undefined
  // self-presence codes 307 and 301: kicked triggers bounded
  // auto-rejoin, banned never does
  kicked?: boolean | undefined
  kickReason?: string | undefined
  banned?: boolean | undefined
  joined?: boolean
  // true once omemo traffic was observed on this conversation (dm)
  encrypted?: boolean | undefined
  // mam paging: the rsm first uid of the oldest page we pulled, sent as
  // the before cursor when fetching further back
  historyCursor?: string | undefined
  // true once the archive reports complete or a page comes back with no
  // first uid to page before
  historyComplete?: boolean | undefined
  historyLoading?: boolean | undefined
  // XEP-0466: ephemeral timer in seconds negotiated for this
  // conversation. 0/undefined means messages persist
  ephemeralTimer?: number | undefined
  // XEP-0492 notification setting for this conversation. Undefined
  // falls back to the default (always for dm, on-mention for muc)
  notify?: NotifySetting | undefined
  // XEP-0301: real-time text buffers per composing sender (bare jid for
  // dm, nick for muc), cleared on message arrival or ttl expiry. seq is
  // the last applied rtt sequence number, used to drop out-of-order edits.
  liveText: SvelteMap<string, { text: string; at: number; seq?: number | undefined }>
  // XEP-0224: timestamp of the last attention request that got through
  // the rate limit. The header flashes while it is fresh
  attentionAt?: number | undefined
  // full jid of the peer resource we last heard from. Feature probes
  // (disco for rtt etc.) target this, not the bare account
  peerFullJid?: string | undefined
}

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

// $state so fields like unread and peerState stay reactive inside the map
export function createConversation(peerJid: string, kind: ConversationKind): Conversation {
  const conversation = $state<Conversation>({
    peerJid,
    kind,
    messages: [],
    unread: 0,
    occupants: new SvelteMap(),
    typers: new SvelteSet(),
    ourNicks: new SvelteSet(),
    liveText: new SvelteMap()
  })
  return conversation
}
