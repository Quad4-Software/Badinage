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
  // XEP-0424: the sender retracted this message; body, attachments and
  // reactions are cleared, the row stays so replies still anchor
  retracted?: boolean | undefined
  // XEP-0382: the body is a spoiler hidden behind a reveal control; the
  // string is the sender's optional hint, empty for a hintless spoiler
  spoilerHint?: string | undefined
  // XEP-0393: the sender asked for the body to render unstyled
  unstyled?: boolean | undefined
  // local-only upload state for an outgoing attachment that is still in
  // flight; never persists meaningfully across restarts
  pending?: boolean | undefined
  // 0..1 upload progress while pending
  uploadProgress?: number | undefined
  // file name shown on the pending upload row
  pendingName?: string | undefined
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
  // room vCard photo as a data URI, fetched lazily when the room opens
  avatar?: string | undefined
  avatarFetched?: boolean | undefined
  occupants: SvelteMap<string, RoomOccupant>
  // muc: nicks currently composing, kept separate from peerState so
  // several members can show as typing at once
  typers: SvelteSet<string>
  ourNick?: string | undefined
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
    typers: new SvelteSet()
  })
  return conversation
}
