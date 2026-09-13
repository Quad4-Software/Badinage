// The public contract of the XMPP transport layer: the ChatConnection
// interface the state layer programs against plus the option and event
// types it references. XmppConnection in connection.ts implements it.
// DemoConnection in demo.ts fakes it. connection.ts re-exports all of
// this so existing importers keep working.

import type { Emitter } from '$lib/core/events'

import type { PepPublishOptions } from './features/pep/pep'
import type { RttEvent, RttOp } from '$lib/utils/protocol/rtt'

import type {
  Bookmark,
  ChannelSearchItem,
  ChatState,
  DataForm,
  DiscoInfo,
  DiscoItem,
  Geoloc,
  IncomingMessage,
  MamPageResult,
  MarkerType,
  MdsDisplayed,
  MessageReference,
  MucDecline,
  MucInvite,
  MucOccupant,
  PresenceError,
  PresenceUpdate,
  RosterItem,
  UploadSlot,
  Vcard
} from './stanzas'

// XEP-0054 own vcard. fetch resolves null when the server has no card or
// refuses the query. Set merges the managed fields over the stored card
// and, when a photo is included, stamps the XEP-0153 hash so presence
// broadcasts advertise it.
export interface VcardApi {
  fetch(onDone: (vcard: Vcard | null) => void): void
  set(vcard: Vcard, onDone: (ok: boolean) => void): void
}

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'authfail' | 'error'

interface SubscriptionRequest {
  from: string
  status: string
}

// XEP-0461 reply target: id is the replied-to stanza id, plus its author
// jid. The author can be named to (wire attribute style) or from (the
// field name used by the parsed IncomingMessage replyTo shape).
type ReplyRef =
  { id: string; to: string } | { id: string; from: string; quote?: string | undefined }

export interface SendMessageOptions {
  replyTo?: ReplyRef | undefined
  // XEP-0308: id of the stanza this message corrects
  replaceId?: string | undefined
  // XEP-0382: mark the body as a spoiler. The string is the optional
  // hint shown before reveal, empty for a hintless spoiler
  spoilerHint?: string | undefined
  // XEP-0466: ephemeral timer in seconds attached to this message
  ephemeral?: number | undefined
  // XEP-0372 body-range references (mentions). Positions are code points
  references?: MessageReference[] | undefined
  // XEP-0080 location payload. A geo: uri body fallback is added by the
  // sender, so callers only pass coordinates
  geoloc?: Geoloc | undefined
}

// XEP-0446 file metadata, all fields optional on the wire.
export interface AttachmentMeta {
  name?: string | undefined
  mediaType?: string | undefined
  size?: number | undefined
  duration?: number | undefined
}

export type ConnectionEvents = {
  status: ConnectionStatus
  message: IncomingMessage
  presence: PresenceUpdate
  roster: RosterItem[]
  rosterUpdate: RosterItem
  rosterRemove: string
  subscriptionRequest: SubscriptionRequest
  occupant: MucOccupant
  // XEP-0191 pushes: jids the server added to or removed from the
  // blocklist. An empty unblocked list means the list was cleared.
  blocked: string[]
  unblocked: string[]
  // XEP-0199 measured server round trip in milliseconds, emitted by the
  // keepalive ping whenever a pong lands
  latency: number
  // XEP-0249 direct or XEP-0045 mediated room invitations
  roomInvite: MucInvite
  // a mediated decline relayed by the room
  roomDecline: MucDecline
  // presence type=error with the stanza error details. MUC join
  // failures (401/403/404/407/409) arrive this way
  presenceError: PresenceError
  // XEP-0402 PEP notification: another of our resources published or
  // retracted bookmark items. Consumers refetch the node (last write
  // wins) rather than trusting the partial update.
  bookmarks: { updated: Bookmark[]; retracted: string[] }
  // XEP-0490 PEP notification: our other resources advanced the
  // displayed marker for these conversations
  mds: MdsDisplayed[]
}

// The transport surface the state layer depends on. XmppConnection is the
// real transport. DemoConnection in demo.ts is the fake one used by demo mode.
export interface ChatConnection {
  readonly events: Emitter<ConnectionEvents>
  readonly connected: boolean
  readonly jid: string
  connect(jid: string, password: string): void
  disconnect(): void
  uniqueId(prefix: string): string
  sendChatMessage(
    to: string,
    body: string,
    type?: 'chat' | 'groupchat',
    opts?: SendMessageOptions
  ): string
  sendReaction(to: string, targetId: string, emojis: string[], type?: 'chat' | 'groupchat'): void
  sendAttachment(
    to: string,
    url: string,
    type?: 'chat' | 'groupchat',
    meta?: AttachmentMeta
  ): string
  // Optional on the interface because demo mode has no upload service to
  // discover. RequestUploadSlot covers the whole flow.
  discoverUploadService?(onDone: (serviceJid: string | null) => void): void
  requestUploadSlot(
    name: string,
    size: number,
    mediaType: string,
    onDone: (slot: UploadSlot | null) => void
  ): void
  uploadFile(
    putUrl: string,
    file: Blob,
    headers?: Record<string, string>,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal
  ): Promise<void>
  sendChatState(to: string, state: ChatState, type?: 'chat' | 'groupchat'): void
  sendReceipt(to: string, id: string): void
  sendMarker(to: string, id: string, marker: MarkerType): void
  sendPresence(show?: string, status?: string): void
  sendDirectedPresence(to: string, type?: string, status?: string): void
  fetchAvatar(jid: string, onDone: (dataUri: string | undefined) => void): void
  // XEP-0054: our own vcard - fetch for the profile editor, set to publish
  readonly vcard: VcardApi
  fetchRoster(): void
  rosterSet(jid: string, name: string, groups?: string[]): void
  rosterRemove(jid: string): void
  // XEP-0191 blocklist. unblockJids with an empty list unblocks all.
  fetchBlocklist(onDone: (jids: string[]) => void): void
  blockJids(jids: string[]): void
  unblockJids(jids: string[]): void
  // PEP item fetch/publish for omemo device lists and bundles. pepGet
  // resolves with the <items> element of the result iq, or null on error.
  pepGet(node: string, jid: string | undefined, onDone: (items: Element | null) => void): void
  // options adds XEP-0060 publish-options so the node config is applied
  // atomically with the publish
  pepPublish(
    node: string,
    itemId: string,
    payloadXml: string,
    options?: PepPublishOptions,
    onDone?: (ok: boolean) => void
  ): void
  // OMEMO: send a pre-encrypted message stanza. encryptedXml is the
  // serialized <encrypted> element produced by the omemo service. Replies
  // and corrections travel inside its SCE envelope, never in the clear.
  sendEncryptedMessage(to: string, encryptedXml: string): string
  // OMEMO: send a bare encrypted payload with no fallback body - used for
  // key transports, reactions and chat states in encrypted conversations.
  sendEncryptedNotification(to: string, encryptedXml: string): void
  joinRoom(room: string, nick: string, password?: string): void
  leaveRoom(room: string, nick: string): void
  setRoomSubject(room: string, subject: string): void
  // in-room nick change via the unavailable-plus-join presence dance
  changeRoomNick(room: string, oldNick: string, newNick: string, password?: string): void
  // XEP-0249 direct invite plus XEP-0045 mediated invite. Sending both
  // covers open rooms and members-only rooms without disco probing.
  // password is carried on the direct invite so protected rooms stay
  // joinable from the invite alone.
  inviteToRoom(
    room: string,
    to: string,
    opts?: { reason?: string | undefined; password?: string | undefined }
  ): void
  // XEP-0045 decline, mediated through the room
  declineRoomInvite(room: string, to: string, reason?: string): void
  // XEP-0045 kick and ban. Ban needs the occupant's real jid
  kickOccupant(room: string, nick: string, reason?: string): void
  banOccupant(room: string, jid: string, reason?: string): void
  // XEP-0425: retract the room message carrying this stanza-id
  moderateMessage(room: string, stanzaId: string, reason?: string): void
  // XEP-0045 owner configuration via a XEP-0004 form. Fetch resolves
  // null when the room refuses (not an owner) or errors
  fetchRoomConfig(room: string, onDone: (form: DataForm | null) => void): void
  submitRoomConfig(room: string, form: DataForm): void
  // XEP-0199 self-ping to our own occupant jid. Alive=false means the
  // room dropped us or the stream timed out
  pingOccupant(room: string, nick: string, onDone: (alive: boolean) => void): void
  queryArchive(
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void
  enableCarbons(): void
  // XEP-0352: tell the server whether the ui is in the foreground. Only
  // sent while connected. Transports may dedupe repeat calls.
  setClientActive(active: boolean): void
  // XEP-0198: whether stream management was negotiated on this session
  streamManagementEnabled(): boolean
  // XEP-0198: whether the current session resumed a previous one
  sessionResumed(): boolean
  // XEP-0424: retract a message we sent. targetId is the stanza id
  // attribute for a dm, the room stanza-id (or origin-id when the room
  // does not assign them) for a muc message.
  sendRetraction(to: string, targetId: string, type?: 'chat' | 'groupchat'): void
  // XEP-0030 service discovery. discoInfo resolves null on error or
  // timeout. A node of the form base#ver is served from the entity-caps
  // cache when the verification string was already resolved before.
  discoInfo(jid: string, node: string | undefined, onDone: (info: DiscoInfo | null) => void): void
  discoItems(jid: string, onDone: (items: DiscoItem[] | null) => void): void
  // XEP-0402 bookmarks on our own PEP node. fetch resolves null when the
  // server lacks PEP. Add republishes and remove retracts one item.
  fetchBookmarks(onDone: (bookmarks: Bookmark[] | null) => void): void
  addBookmark(bookmark: Bookmark, onDone?: (ok: boolean) => void): void
  removeBookmark(jid: string, onDone?: (ok: boolean) => void): void
  // XEP-0224: send an attention request. No body - the stanza is a pure
  // signal and receivers rate-limit it.
  sendAttention(to: string, type?: 'chat' | 'groupchat'): void
  // XEP-0301: send one real-time text update. seq increments per edit of
  // the same composed message. Event and ops carry the delta.
  sendRtt(to: string, seq: number, event: RttEvent, ops: RttOp[]): void
  // XEP-0186: toggle invisibility through a privacy list that denies
  // outbound presence. onDone reports whether the server accepted it.
  setInvisible(enabled: boolean, onDone: (ok: boolean) => void): void
  // XEP-0490: publish the displayed marker for a conversation on our
  // private MDS node. By echoes the stanza-id assigner when known
  publishDisplayed(
    peer: string,
    stanzaId: string,
    by?: string,
    onDone?: (ok: boolean) => void
  ): void
  // XEP-0301: one disco#info probe resolving whether the peer advertises
  // real-time text support. Results cache in the disco layer.
  rttSupported(jid: string, onDone: (supported: boolean) => void): void
  // XEP-0433: fetch the search form a channel search service offers, or
  // null when the jid does not run the protocol
  channelSearchForm(service: string, onDone: (form: DataForm | null) => void): void
  // XEP-0433: submit a filled form and get result items back
  channelSearch(
    service: string,
    form: DataForm,
    onDone: (items: ChannelSearchItem[] | null) => void
  ): void
}
