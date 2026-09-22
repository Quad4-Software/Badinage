// The transport contract: the event map a connection emits and the
// ChatConnection interface the state layer programs against.
// XmppConnection in ../connection.ts implements it, DemoConnection in
// ../demo.ts fakes it.

import type { Emitter } from '$lib/core/events'
import type { RttEvent, RttOp } from '$lib/utils/protocol/rtt'

import type { PepPublishOptions } from '../features/pep/pep'
import type { StanzaBuilder } from '../features/transport'
import type { ExtService } from '../jingle/extdisco'
import type { JinglePacket } from '../jingle/types'
import type {
  Bookmark,
  ChannelSearchItem,
  ChatState,
  DataForm,
  DiscoInfo,
  DiscoItem,
  IncomingMessage,
  MamPageResult,
  MarkerType,
  MdsDisplayed,
  MucDecline,
  MucInvite,
  MucOccupant,
  PresenceError,
  PresenceUpdate,
  RosterItem,
  TrustOwner,
  UploadSlot
} from '../stanzas'

import type {
  AttachmentMeta,
  ChatKind,
  ConnectionStatus,
  SendMessageOptions,
  TransportCapabilities,
  VcardApi
} from './api'

export type ConnectionEvents = {
  status: ConnectionStatus
  message: IncomingMessage
  presence: PresenceUpdate
  roster: RosterItem[]
  rosterUpdate: RosterItem
  rosterRemove: string
  subscriptionRequest: { from: string; status: string }
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
  // XEP-0402 PEP notification: another resource published or retracted
  // bookmark items. Consumers refetch the node (last write wins)
  bookmarks: { updated: Bookmark[]; retracted: string[] }
  // XEP-0490 PEP notification: our other resources advanced the
  // displayed marker for these conversations
  mds: MdsDisplayed[]
  // IRC draft/read-marker: another client moved the read cursor to this
  // timestamp (ms). stanza-id based markers come through mds instead
  readMarker: { peer: string; timestamp: number }
  // XEP-0166 jingle session actions, iq-level acked on receipt
  jingle: JinglePacket
}

// The transport surface the state layer depends on. XmppConnection is the
// real transport. DemoConnection in demo.ts is the fake one used by demo mode.
export interface ChatConnection {
  readonly events: Emitter<ConnectionEvents>
  readonly connected: boolean
  readonly jid: string
  // transports that cannot do the full feature set declare it here.
  // Undefined means everything is supported (XMPP, demo)
  readonly capabilities?: TransportCapabilities | undefined
  connect(jid: string, password: string): void
  disconnect(): void
  uniqueId(prefix: string): string
  sendChatMessage(to: string, body: string, type?: ChatKind, opts?: SendMessageOptions): string
  sendReaction(to: string, targetId: string, emojis: string[], type?: ChatKind): void
  sendAttachment(to: string, url: string, type?: ChatKind, meta?: AttachmentMeta): string
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
  sendChatState(to: string, state: ChatState, type?: ChatKind): void
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
  sendEncryptedMessage(to: string, encryptedXml: string, type?: ChatKind): string
  // OMEMO: send a bare encrypted payload with no fallback body - used for
  // key transports, reactions and chat states in encrypted conversations.
  sendEncryptedNotification(to: string, encryptedXml: string): void
  // XEP-0434: send a trust sync stanza to our own bare jid so other
  // devices learn the decision. usage names the encryption namespace
  // the fingerprints belong to
  sendTrustMessage(to: string, usage: string, owners: TrustOwner[]): void
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
  // XEP-0045 admin grant of member affiliation, which members-only rooms
  // need to admit an invitee. Requires admin or owner rights
  grantMembership(room: string, jid: string): void
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
  sendRetraction(to: string, targetId: string, type?: ChatKind): void
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
  sendAttention(to: string, type?: ChatKind): void
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
  // XEP-0166 jingle calls. Optional on the interface because IRC and
  // demo place no calls - the ui hides call controls when absent
  sendJingle?(stanza: StanzaBuilder, onDone?: (ok: boolean) => void): void
  jingleSupported?(jid: string, onDone: (supported: boolean) => void): void
  // XEP-0215: stun and turn relays our own server advertises
  externalServices?(onDone: (services: ExtService[]) => void): void
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
