// Conversation model: the message list, unread counter, chat states and
// MUC room metadata for one peer. Pure data plus a reactive factory;
// mutation lives in ChatStore (chats.svelte.ts).

import { SvelteMap, SvelteSet } from 'svelte/reactivity'

import type { Attachment, ChatState } from '$lib/core/xmpp/stanzas'

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
  // XEP-0421 stable sender id on groupchat messages; reaction sender
  // keys prefer it over the nick so renames do not split reactions
  occupantId?: string | undefined
  // XEP-0424/0425 tombstone: the message was retracted, optionally with
  // a reason given by the moderator
  retracted?: boolean | undefined
  retractReason?: string | undefined
  // decryption failed or the stanza could not be shown as text
  undecryptable?: boolean | undefined
  // decrypted, but the sending device is distrusted or changed keys
  untrustedDevice?: boolean | undefined
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
  // room vCard photo as a data URI, fetched lazily when the room opens
  avatar?: string | undefined
  avatarFetched?: boolean | undefined
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
    ourNicks: new SvelteSet()
  })
  return conversation
}
