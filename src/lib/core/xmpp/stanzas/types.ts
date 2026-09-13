// Stanza parsing: pure Element -> typed event helpers. Everything here is a
// pure function over DOM Elements so it can be unit tested without Strophe.
// Uses getElementsByTagName(NS) rather than querySelector because the test
// suite runs under @xmldom/xmldom, which has no selector engine.

import type { RttStanza } from '$lib/utils/protocol/rtt'

export interface RosterItem {
  jid: string
  name: string
  subscription: string
  ask?: string | undefined
  groups: string[]
}

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
  // carbons: another device of ours sent ('sent') or received ('received')
  // this. mam: the stanza came out of an archive query. Neither means live.
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
  // list retracts all previous reactions from this sender.
  reactionTo?: { id: string; emojis: string[] } | undefined
  // XEP-0308: this body replaces the stanza with this id.
  replaceId?: string | undefined
  // XEP-0424: this stanza asks receivers to retract the message whose id
  // it names (the stanza id attribute in a dm, the room stanza-id in a
  // muc). An empty string means a retract element that carried no usable
  // id. The fallback body must still never render. The older draft form
  // wrapped message-retract:0 in a fasten apply-to and is also accepted.
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
  // serialized <encrypted> element, handed to the OMEMO service for
  // async decryption before ingest
  encryptedXml?: string | undefined
  // decryption was attempted and failed. The body must not be trusted
  undecryptable?: boolean | undefined
  // decrypted, but the sending device is distrusted or changed keys
  untrustedDevice?: boolean | undefined
  // XEP-0421: stable sender id on groupchat traffic, survives renames
  occupantId?: string | undefined
  // XEP-0425: the room tells us the message carrying this stanza-id was
  // retracted by a moderator. by is the moderating entity when the room
  // discloses it.
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
  // stanza type=error: a bounce referencing our sent message id. The
  // store marks that message failed. The stanza never becomes a row, so
  // a forged error cannot inject a body
  error?: { condition?: string | undefined; text?: string | undefined } | undefined
}

export interface PresenceUpdate {
  from: string
  show: string
  status: string
  type?: string | undefined
  // XEP-0115 entity capabilities advertised in the c element
  caps?: CapsRef | undefined
  // XEP-0153 vcard-temp:x:update photo hash. The empty string means the
  // contact explicitly advertises no avatar, undefined means no update
  // element was present and the cached avatar stays untouched
  avatarHash?: string | undefined
}

export interface MucOccupant {
  room: string
  nick: string
  presence: string
  affiliation: string
  role: string
  self: boolean
  codes: string[]
  // real jid, only exposed by non-anonymous rooms via the item jid attr
  jid?: string | undefined
  // XEP-0421 stable id attached to occupant presence
  occupantId?: string | undefined
  // the item nick attribute on a 303 nick-change broadcast
  newNick?: string | undefined
  // kick or ban reason from the item reason element, or the status text
  reason?: string | undefined
  caps?: CapsRef | undefined
  avatarHash?: string | undefined
}

// Presence type=error carrying an RFC 6120 stanza error. On the room
// join path this is how 401/403/404/407/409 failures arrive.
export interface PresenceError {
  from: string
  code?: string | undefined
  condition?: string | undefined
  text?: string | undefined
}

// XEP-0249 direct invite or XEP-0045 mediated invite arriving as a
// message stanza.
export interface MucInvite {
  room: string
  // the inviter: stanza from for direct invites, the invite from
  // attribute for mediated ones
  from: string
  kind: 'direct' | 'mediated'
  password?: string | undefined
  reason?: string | undefined
  // XEP-0249 continue flag: the room continues an existing 1:1 thread
  continueSession?: boolean | undefined
}

// XEP-0045 mediated decline, relayed by the room.
export interface MucDecline {
  room: string
  from: string
  reason?: string | undefined
}

// XEP-0004 data form, parsed generically so room configuration and any
// future form consumer share one shape.
interface DataFormOption {
  value: string
  label?: string | undefined
}

export interface DataFormField {
  var: string
  type?: string | undefined
  label?: string | undefined
  desc?: string | undefined
  required: boolean
  values: string[]
  options: DataFormOption[]
}

export interface DataForm {
  title?: string | undefined
  instructions?: string | undefined
  fields: DataFormField[]
}

// XEP-0115 c element: node identifies the client software, ver is the
// verification string hashing the advertised identity and features
export interface CapsRef {
  node: string
  hash: string
  ver: string
}

// XEP-0030 disco#info result
export interface DiscoIdentity {
  category: string
  type: string
  name?: string | undefined
  lang?: string | undefined
}

// one field of a XEP-0128 service discovery extension form
export interface DiscoField {
  var: string
  values: string[]
}

export interface DiscoForm {
  formType: string
  fields: DiscoField[]
}

export interface DiscoInfo {
  identities: DiscoIdentity[]
  features: string[]
  forms: DiscoForm[]
}

// XEP-0030 disco#items entry
export interface DiscoItem {
  jid: string
  node?: string | undefined
  name?: string | undefined
}

// XEP-0402 PEP bookmark. kind 'contact' is serialized as a contact
// element in the bookmarks namespace: the spec only defines conference,
// so this is a client-local extension that other clients ignore.
// XEP-0492 fallback notification setting carried on a bookmark. The
// identity-specific variants are parsed but only the attribute-free
// fallback drives our behavior.
export type NotifySetting = 'always' | 'on-mention' | 'never'

// XEP-0054 vcard-temp profile. Only the fields the profile editor
// manages are parsed. PhotoUri is the PHOTO element as a data uri,
// absent when the card carries no image photo.
export interface Vcard {
  fn: string
  nickname: string
  desc: string
  photoUri?: string | undefined
}

export interface Bookmark {
  jid: string
  kind: 'conference' | 'contact'
  name?: string | undefined
  autojoin?: boolean | undefined
  nick?: string | undefined
  password?: string | undefined
  // XEP-0492 notify element found inside the bookmark extensions
  notify?: NotifySetting | undefined
  // serialized extension children we do not understand, kept verbatim so
  // republishing the bookmark does not strip them (XEP-0402 rule)
  extensionsXml?: string[] | undefined
}

// XEP-0363 slot granted by an upload service: PUT the file to putUrl,
// share getUrl.
export interface UploadSlot {
  putUrl: string
  getUrl: string
}

// One page of a MAM query result. rsm uid of the oldest row in this
// page is first - pass it as before to fetch the next older page.
export interface MamPageResult {
  complete: boolean
  last?: string | undefined
  first?: string | undefined
}
