// Message stanza shapes: the IncomingMessage event the parsers emit and
// the small types it references (chat states, markers, attachments,
// references, geoloc, trust owners).

import type { RttStanza } from '$lib/utils/protocol/rtt'

export type ChatState = 'active' | 'composing' | 'paused' | 'inactive' | 'gone'
export type MarkerType = 'received' | 'displayed' | 'acknowledged'

export interface Attachment {
  url: string
  mediaType: string
  name?: string | undefined
  size?: number | undefined
  duration?: number | undefined
}

// XEP-0372 reference: a body range (begin/end in Unicode code points)
// tagged with a type and optionally a uri or anchor.
export interface MessageReference {
  type: string
  begin?: number | undefined
  end?: number | undefined
  uri?: string | undefined
  anchor?: string | undefined
}

// XEP-0080 sender location, coordinates in decimal degrees.
export interface Geoloc {
  lat: number
  lon: number
  accuracy?: number | undefined
}

export interface IncomingMessage {
  from: string
  to: string
  body: string
  type: 'chat' | 'groupchat'
  // the stanza's own id attribute - receipts and chat markers reference this
  id?: string | undefined
  stanzaId?: string | undefined
  // the entity that assigned stanzaId. XEP-0490 echoes it back verbatim
  stanzaBy?: string | undefined
  originId?: string | undefined
  delay?: number | undefined
  // carbon: another device of ours sent or received this. mam: the stanza
  // came out of an archive query. Neither means live.
  carbon?: 'sent' | 'received' | undefined
  mam?: boolean | undefined
  chatState?: ChatState | undefined
  receiptRequest?: boolean | undefined
  receiptFor?: string | undefined
  marker?: { id: string; type: MarkerType } | undefined
  nick?: string | undefined
  subject?: string | undefined
  // XEP-0461: this message replies to the stanza with this id, sent by the
  // jid in from. quote is the text recovered from the body fallback.
  replyTo?: { id: string; from: string; quote?: string | undefined } | undefined
  // XEP-0444: reactions targeting the stanza with this id. An empty emojis
  // list retracts all previous reactions from this sender. remove=true
  // drops only the named emojis (IRC +draft/unreact cannot express a
  // full replacement set)
  reactionTo?: { id: string; emojis: string[]; remove?: boolean | undefined } | undefined
  // XEP-0308: this body replaces the stanza with this id.
  replaceId?: string | undefined
  // XEP-0424: retract the message with this id (stanza id in a dm, room
  // stanza-id in a muc). Empty means a retract element without a usable
  // id. The older draft form wrapped message-retract:0 in fasten.
  retractId?: string | undefined
  // XEP-0382: the body is a spoiler. The element text is an optional
  // hint. An empty string means a spoiler without a hint.
  spoilerHint?: string | undefined
  // XEP-0393: the sender asked receivers to render the body unstyled.
  unstyled?: boolean | undefined
  attachments?: Attachment[] | undefined
  // signature state for the UI: set by transports that can prove it
  // (OMEMO once verification lands, OpenPGP later). Not parsed here.
  signed?: boolean | undefined
  encrypted?: boolean | undefined
  // serialized <encrypted> element, decrypted by the omemo service
  encryptedXml?: string | undefined
  // decryption failed: the body must not be trusted
  undecryptable?: boolean | undefined
  // decrypted, but the sending device is distrusted or changed keys
  untrustedDevice?: boolean | undefined
  // XEP-0421: stable sender id on groupchat traffic, survives renames
  occupantId?: string | undefined
  // XEP-0425: the message carrying this stanza-id was retracted by a
  // moderator. by is the moderating entity when the room discloses it
  retraction?: { id: string; reason?: string | undefined; by?: string | undefined } | undefined
  // XEP-0424/0425 tombstone: this stanza is itself the archived form of
  // an already retracted message
  retracted?: { reason?: string | undefined; by?: string | undefined } | undefined
  // XEP-0224: the sender requests attention. The stanza may carry no body
  attention?: boolean | undefined
  // XEP-0301 real-time text edits for the message the peer is composing
  rtt?: RttStanza | undefined
  // XEP-0372 body ranges and linked entities. Mentions are one type
  references?: MessageReference[] | undefined
  // XEP-0466: seconds after which the message should self-destruct. A
  // timer of 0 disables ephemeral mode for the conversation
  ephemeralTimer?: number | undefined
  // XEP-0080 location shared by the sender
  geoloc?: Geoloc | undefined
  // stanza type=error: a bounce referencing our sent message id. Never a
  // row, so a forged error cannot inject a body
  error?: { condition?: string | undefined; text?: string | undefined } | undefined
  // XEP-0434: trust decisions synced from another of our own devices,
  // fingerprints mapped back to devices by the omemo service
  trustMessage?: { usage?: string | undefined; owners: TrustOwner[] } | undefined
}

// XEP-0434 key-owner: fingerprints the sender trusts or distrusts
export interface TrustOwner {
  jid: string
  trust: string[]
  distrust: string[]
}
