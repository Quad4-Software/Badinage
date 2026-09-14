// Transport layer: owns the Strophe connection, reconnect backoff, and the
// event surface the rest of the app consumes. The public contract lives in
// types.ts (re-exported below), stanza parsing in stanzas.ts, and the wire
// flows in the feature modules under features/. Keep protocol knowledge
// out of this file.

import { $iq, Strophe } from 'strophe.js'

import { RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS } from '$lib/constants'
import { Emitter } from '$lib/core/events'

import { createVcardApi, fetchAvatar } from './features/pep/avatars'
import { blockJids, fetchBlocklist, unblockJids } from './features/blocking'
import { fetchBookmarks, publishBookmark, retractBookmark } from './features/pep/bookmarks'
import { sendClientState } from './features/csi'
import { discoInfo, discoItems } from './features/disco'
import { makeTransport, noteStreamFeatures, registerStanzaHandlers } from './connection-handlers'
import { queryArchive } from './features/mam'
import {
  sendAttachment,
  sendAttention,
  sendChatMessage,
  sendChatState,
  sendMarker,
  sendReaction,
  sendReceipt,
  sendRetraction,
  sendRtt,
  sendTrustMessage
} from './features/messaging'
import {
  banOccupant,
  changeRoomNick,
  fetchRoomConfig,
  grantMembership,
  inviteToRoom,
  joinRoom,
  kickOccupant,
  leaveRoom,
  moderateMessage,
  pingOccupant,
  sendRoomDecline,
  setRoomSubject,
  submitRoomConfig
} from './features/muc'
import {
  pepGet,
  pepPublish,
  sendEncryptedMessage,
  sendEncryptedNotification,
  type PepPublishOptions
} from './features/pep/pep'
import { PingManager } from './features/ping'
import { sendDirectedPresence, sendPresence } from './features/presence'
import { publishDisplayed } from './features/pep/mds'
import { setInvisible } from './features/privacy'
import { fetchRoster, rosterRemove, rosterSet } from './features/roster'
import { channelSearch, channelSearchForm } from './features/search'
import { smConnectionOptions } from './features/sm'
import { noop, type StanzaBuilder, type XmppTransport } from './features/transport'
import { discoverUploadService, requestUploadSlot, uploadFile } from './features/upload'
import { NS } from './ns'
import type { RttEvent, RttOp } from '$lib/utils/protocol/rtt'
import { bareJid } from '$lib/utils/jid'

import type {
  Bookmark,
  ChannelSearchItem,
  ChatState,
  DataForm,
  DiscoInfo,
  DiscoItem,
  MamPageResult,
  MarkerType,
  TrustOwner,
  UploadSlot
} from './stanzas'
import type { AttachmentMeta, ChatConnection, ConnectionEvents, SendMessageOptions } from './types'

// The public contract lives in types.ts and the parsed result shapes in
// stanzas.ts. Re-exported here so importers of this module keep working.
export type { Bookmark, DiscoInfo, DiscoItem, MamPageResult, UploadSlot } from './stanzas'
export type { PepPublishOptions } from './features/pep/pep'
export type {
  AttachmentMeta,
  ChatConnection,
  ConnectionEvents,
  ConnectionStatus,
  SendMessageOptions
} from './types'

type StropheConnection = InstanceType<typeof Strophe.Connection>

export class XmppConnection implements ChatConnection {
  readonly events = new Emitter<ConnectionEvents>()

  private conn: StropheConnection
  private readonly transport: XmppTransport
  private readonly ping: PingManager
  private reconnectDelay = RECONNECT_DELAY_MS
  private manualDisconnect = false
  // XEP-0352 desired and last-sent client state. Null means the ui never
  // told us, so nothing is sent
  private csiActive: boolean | null = null
  private csiSent: boolean | null = null
  // namespaces advertised in stream:features. Nonzas a server does not
  // know are fatal on strict stacks, so carbons and csi only go out when
  // the stream advertised them
  private streamFeatures = new Set<string>()
  // in-flight MAM queryids: only these result wrappers (or our own) unwrap
  private readonly mamQueries = new Set<string>()
  readonly vcard = createVcardApi(() => this.transport) // thunked: transport is post-ctor

  constructor(
    private readonly service: string,
    conn?: StropheConnection,
    opts?: { oauth?: boolean | undefined }
  ) {
    // XEP-0198 stream management is negotiated by strophe itself when the
    // option is set. A test-supplied connection keeps its own options.
    // oauth logins restrict the mechanism list to OAUTHBEARER so a token
    // in the password slot cannot be misread as a scram credential on
    // servers that offer both
    const options = { ...smConnectionOptions() }
    if (opts?.oauth) options.mechanisms = [Strophe.SASLOAuthBearer]
    this.conn = conn ?? new Strophe.Connection(service, options)
    this.transport = makeTransport(this.conn, this.sendIq.bind(this))
    this.ping = new PingManager(this.transport, (ms) => this.events.emit('latency', ms))
    // inbound stanzas reset the keepalive silence clock
    this.conn.xmlInput = () => this.ping.noteInbound()
  }

  get connected(): boolean {
    return this.conn.connected
  }

  get jid(): string {
    return this.conn.jid ?? ''
  }

  connect(jid: string, password: string): void {
    this.manualDisconnect = false
    this.conn.connect(jid, password, (status) => this.onStatus(status))
  }

  disconnect(): void {
    this.manualDisconnect = true
    this.ping.stop()
    this.conn.disconnect()
  }

  uniqueId(prefix: string): string {
    return this.conn.getUniqueId(prefix)
  }

  sendIq(
    stanza: StanzaBuilder,
    onResult: (stanza: Element) => void,
    onError?: (stanza: Element | null) => void
  ): void {
    if (!this.conn.connected) {
      // queued iq work (omemo publish, disco) can race a teardown. Report
      // it as a failed send instead of throwing on a dead transport
      const fail = onError ?? noop
      fail(null)
      return
    }
    this.conn.sendIQ(stanza, onResult, onError ?? noop)
  }

  // ---- messaging, implemented in features/messaging.ts ---------------------

  sendChatMessage(
    to: string,
    body: string,
    type: 'chat' | 'groupchat' = 'chat',
    opts?: SendMessageOptions
  ): string {
    return sendChatMessage(this.transport, to, body, type, opts)
  }

  sendReaction(
    to: string,
    targetId: string,
    emojis: string[],
    type: 'chat' | 'groupchat' = 'chat'
  ): void {
    sendReaction(this.transport, to, targetId, emojis, type)
  }

  sendAttachment(
    to: string,
    url: string,
    type: 'chat' | 'groupchat' = 'chat',
    meta?: AttachmentMeta
  ): string {
    return sendAttachment(this.transport, to, url, type, meta)
  }

  sendChatState(to: string, state: ChatState, type: 'chat' | 'groupchat' = 'chat'): void {
    sendChatState(this.transport, to, state, type)
  }

  sendReceipt(to: string, id: string): void {
    sendReceipt(this.transport, to, id)
  }

  sendMarker(to: string, id: string, marker: MarkerType): void {
    sendMarker(this.transport, to, id, marker)
  }

  sendRetraction(to: string, targetId: string, type: 'chat' | 'groupchat' = 'chat'): void {
    sendRetraction(this.transport, to, targetId, type)
  }

  sendAttention(to: string, type: 'chat' | 'groupchat' = 'chat'): void {
    sendAttention(this.transport, to, type)
  }

  sendRtt(to: string, seq: number, event: RttEvent, ops: RttOp[]): void {
    sendRtt(this.transport, to, seq, event, ops)
  }

  // ---- HTTP upload, implemented in features/upload.ts -----------------------

  discoverUploadService(onDone: (serviceJid: string | null) => void): void {
    discoverUploadService(this.transport, onDone)
  }

  requestUploadSlot(
    name: string,
    size: number,
    mediaType: string,
    onDone: (slot: UploadSlot | null) => void
  ): void {
    requestUploadSlot(this.transport, name, size, mediaType, onDone)
  }

  uploadFile(
    putUrl: string,
    file: Blob,
    headers?: Record<string, string>,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return uploadFile(putUrl, file, headers, onProgress, signal)
  }

  // ---- PEP / OMEMO, implemented in features/pep/pep.ts ---------------------------

  pepGet(node: string, jid: string | undefined, onDone: (items: Element | null) => void): void {
    pepGet(this.transport, node, jid, onDone)
  }

  pepPublish(
    node: string,
    itemId: string,
    payloadXml: string,
    options?: PepPublishOptions,
    onDone?: (ok: boolean) => void
  ): void {
    pepPublish(this.transport, node, itemId, payloadXml, options, onDone)
  }

  sendEncryptedMessage(to: string, encryptedXml: string, type?: 'chat' | 'groupchat'): string {
    return sendEncryptedMessage(this.transport, to, encryptedXml, type)
  }
  sendEncryptedNotification(to: string, encryptedXml: string): void {
    sendEncryptedNotification(this.transport, to, encryptedXml)
  }
  sendTrustMessage(to: string, usage: string, owners: TrustOwner[]): void {
    sendTrustMessage(this.transport, to, usage, owners)
  }

  // ---- presence / avatars / vcard, in features/presence.ts and features/pep/ ---

  sendPresence(show?: string, status?: string): void {
    sendPresence(this.transport, show, status)
  }

  sendDirectedPresence(to: string, type?: string, status?: string): void {
    sendDirectedPresence(this.transport, to, type, status)
  }

  fetchAvatar(jid: string, onDone: (dataUri: string | undefined) => void): void {
    fetchAvatar(this.transport, jid, onDone)
  }

  // ---- roster, implemented in features/roster.ts ------------------------------

  fetchRoster(): void {
    fetchRoster(this.transport, (items) => this.events.emit('roster', items))
  }

  rosterSet(jid: string, name: string, groups: string[] = []): void {
    rosterSet(this.transport, jid, name, groups)
  }

  rosterRemove(jid: string): void {
    rosterRemove(this.transport, jid)
  }

  // ---- blocking (XEP-0191), implemented in features/blocking.ts ----------------

  fetchBlocklist(onDone: (jids: string[]) => void): void {
    fetchBlocklist(this.transport, onDone)
  }

  blockJids(jids: string[]): void {
    blockJids(this.transport, jids)
  }

  unblockJids(jids: string[]): void {
    unblockJids(this.transport, jids)
  }

  // ---- MUC, implemented in features/muc.ts -------------------------------------

  joinRoom(room: string, nick: string, password?: string): void {
    joinRoom(this.transport, room, nick, password)
  }

  leaveRoom(room: string, nick: string): void {
    leaveRoom(this.transport, room, nick)
  }

  setRoomSubject(room: string, subject: string): void {
    setRoomSubject(this.transport, room, subject)
  }

  changeRoomNick(room: string, oldNick: string, newNick: string, password?: string): void {
    changeRoomNick(this.transport, room, oldNick, newNick, password)
  }

  inviteToRoom(room: string, to: string, opts?: { reason?: string; password?: string }): void {
    inviteToRoom(this.transport, room, to, opts)
  }

  declineRoomInvite(room: string, to: string, reason?: string): void {
    sendRoomDecline(this.transport, room, to, reason)
  }

  grantMembership(room: string, jid: string): void {
    grantMembership(this.transport, room, jid)
  }

  kickOccupant(room: string, nick: string, reason?: string): void {
    kickOccupant(this.transport, room, nick, reason)
  }

  banOccupant(room: string, jid: string, reason?: string): void {
    banOccupant(this.transport, room, jid, reason)
  }

  moderateMessage(room: string, stanzaId: string, reason?: string): void {
    moderateMessage(this.transport, room, stanzaId, reason)
  }

  fetchRoomConfig(room: string, onDone: (form: DataForm | null) => void): void {
    fetchRoomConfig(this.transport, room, onDone)
  }

  submitRoomConfig(room: string, form: DataForm): void {
    submitRoomConfig(this.transport, room, form)
  }

  pingOccupant(room: string, nick: string, onDone: (alive: boolean) => void): void {
    pingOccupant(this.transport, room, nick, onDone)
  }

  // ---- MAM, implemented in features/mam.ts ---------------------------------------

  // results arrive as 'message' events flagged mam=true, onDone fires on fin
  queryArchive(
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void {
    queryArchive(
      this.transport,
      this.mamQueries,
      this.conn.getUniqueId('mam'),
      peerJid,
      opts,
      onDone
    )
  }

  enableCarbons(): void {
    if (!this.streamFeatures.has(NS.CARBONS)) return
    this.sendIq(
      $iq({ type: 'set', id: this.conn.getUniqueId('carbons') }).c('enable', {
        xmlns: NS.CARBONS
      }),
      noop
    )
  }

  // ---- client state and stream management ------------------------------------

  setClientActive(active: boolean): void {
    this.csiActive = active
    if (!this.conn.connected || this.csiSent === active || !this.streamFeatures.has(NS.CSI)) return
    this.csiSent = active
    sendClientState(this.transport, active)
  }

  streamManagementEnabled(): boolean {
    return this.conn.isStreamManagementEnabled()
  }

  sessionResumed(): boolean {
    return this.conn.hasResumed()
  }

  // ---- service discovery (XEP-0030), implemented in features/disco.ts ----------

  discoInfo(jid: string, node: string | undefined, onDone: (info: DiscoInfo | null) => void): void {
    discoInfo(this.transport, jid, node, onDone)
  }

  discoItems(jid: string, onDone: (items: DiscoItem[] | null) => void): void {
    discoItems(this.transport, jid, onDone)
  }

  // ---- bookmarks (XEP-0402), implemented in features/pep/bookmarks.ts --------------

  fetchBookmarks(onDone: (bookmarks: Bookmark[] | null) => void): void {
    fetchBookmarks(this.transport, onDone)
  }

  addBookmark(bookmark: Bookmark, onDone?: (ok: boolean) => void): void {
    publishBookmark(this.transport, bookmark, onDone)
  }

  removeBookmark(jid: string, onDone?: (ok: boolean) => void): void {
    retractBookmark(this.transport, jid, onDone)
  }

  // ---- invisibility (XEP-0186) and channel search (XEP-0433) ---------
  setInvisible(enabled: boolean, onDone: (ok: boolean) => void): void {
    setInvisible(this.transport, enabled, onDone)
  }

  publishDisplayed(
    peer: string,
    stanzaId: string,
    by?: string,
    onDone?: (ok: boolean) => void
  ): void {
    publishDisplayed(this.transport, peer, stanzaId, by, onDone)
  }

  rttSupported(jid: string, onDone: (supported: boolean) => void): void {
    this.discoInfo(jid, undefined, (info) => {
      onDone(info?.features.includes(NS.RTT) === true)
    })
  }

  channelSearchForm(service: string, onDone: (form: DataForm | null) => void): void {
    channelSearchForm(this.transport, service, onDone)
  }

  channelSearch(
    service: string,
    form: DataForm,
    onDone: (items: ChannelSearchItem[] | null) => void
  ): void {
    channelSearch(this.transport, service, form, onDone)
  }

  // ---- internals -----------------------------------------------------------------

  private onStatus(status: number): void {
    switch (status) {
      case Strophe.Status.CONNECTING:
      case Strophe.Status.AUTHENTICATING:
        this.events.emit('status', 'connecting')
        break
      case Strophe.Status.CONNECTED:
      case Strophe.Status.ATTACHED:
        this.reconnectDelay = RECONNECT_DELAY_MS
        this.onConnected()
        this.ping.start()
        this.events.emit('status', 'connected')
        break
      case Strophe.Status.DISCONNECTING:
        this.events.emit('status', 'disconnecting')
        break
      case Strophe.Status.AUTHFAIL:
        this.events.emit('status', 'authfail')
        break
      case Strophe.Status.ERROR:
      case Strophe.Status.CONNTIMEOUT:
      case Strophe.Status.CONNFAIL:
        this.events.emit('status', 'error')
        break
      case Strophe.Status.DISCONNECTED:
        this.ping.stop()
        // a dead stream never answers: clear queryids before the next session
        this.mamQueries.clear()
        this.events.emit('status', 'disconnected')
        if (!this.manualDisconnect) this.scheduleReconnect()
        break
    }
  }

  private onConnected(): void {
    noteStreamFeatures(this.conn, this.streamFeatures)
    registerStanzaHandlers(
      this.conn,
      this.transport,
      this.events,
      () => bareJid(this.jid),
      this.mamQueries
    )
    this.enableCarbons()
    this.sendPresence()
    this.fetchRoster()
    // a reconnect re-establishes csi: only a hidden tab needs re-sending
    this.csiSent = null
    if (this.csiActive === false) this.setClientActive(false)
  }

  private scheduleReconnect(): void {
    const { jid, pass } = this.conn
    if (!jid || typeof pass !== 'string' || !pass) return
    setTimeout(() => {
      if (!this.manualDisconnect && !this.conn.connected) {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_DELAY_MAX_MS)
        this.connect(jid, pass)
      }
    }, this.reconnectDelay)
  }
}
