// Transport layer: owns the Strophe connection, reconnect backoff, and the
// event surface the rest of the app consumes. The public contract lives in
// types.ts (re-exported below), stanza parsing in stanzas.ts, and the wire
// flows in the feature modules under features/. Keep protocol knowledge
// out of this file. The thin wire delegates live in api.ts.

import { $iq, Strophe } from 'strophe.js'

import { RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS } from '$lib/constants'
import { Emitter } from '$lib/core/events'
import { bareJid } from '$lib/utils/jid'

import { XmppConnectionApi } from './api'
import { makeTransport, noteStreamFeatures, registerStanzaHandlers } from '../connection-handlers'
import { fetchBookmarks, publishBookmark, retractBookmark } from '../features/pep/bookmarks'
import { sendClientState } from '../features/csi'
import { discoInfo, discoItems } from '../features/disco'
import { queryArchive } from '../features/mam'
import { publishDisplayed } from '../features/pep/mds'
import { createVcardApi } from '../features/pep/avatars'
import { PingManager } from '../features/ping'
import { setInvisible } from '../features/privacy'
import { channelSearch, channelSearchForm } from '../features/search'
import { smConnectionOptions } from '../features/sm'
import { noop, type StanzaBuilder } from '../features/transport'
import { fetchExtServices, probeJingleSupport, sendJingleIq } from '../jingle/feature'
import type { ExtService } from '../jingle/extdisco'
import { NS } from '../ns'

import type {
  Bookmark,
  ChannelSearchItem,
  DataForm,
  DiscoInfo,
  DiscoItem,
  MamPageResult
} from '../stanzas'
import type { ChatConnection, ConnectionEvents } from '../types'

type Done = (ok: boolean) => void
type ArchiveOpts = { max?: number; before?: string | undefined; room?: boolean | undefined }
type SearchDone = (items: ChannelSearchItem[] | null) => void

// The public contract lives in types.ts and the parsed result shapes in
// stanzas.ts. Re-exported here so importers of this module keep working.
export type { Bookmark, DiscoInfo, DiscoItem, MamPageResult, UploadSlot } from '../stanzas'
export type { PepPublishOptions } from '../features/pep/pep'
export type {
  AttachmentMeta,
  ChatConnection,
  ConnectionEvents,
  ConnectionStatus,
  SendMessageOptions
} from '../types'

type StropheConnection = InstanceType<typeof Strophe.Connection>

export class XmppConnection extends XmppConnectionApi implements ChatConnection {
  readonly events = new Emitter<ConnectionEvents>()

  private readonly ping: PingManager
  private reconnectDelay = RECONNECT_DELAY_MS
  private manualDisconnect = false
  readonly vcard = createVcardApi(() => this.transport) // thunked: transport is post-ctor

  constructor(
    private readonly service: string,
    conn?: StropheConnection,
    opts?: { oauth?: boolean | undefined }
  ) {
    super()
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

  // ---- MAM, implemented in features/mam.ts ---------------------------------------

  // results arrive as 'message' events flagged mam=true, onDone fires on fin
  queryArchive(peerJid: string, opts: ArchiveOpts, onDone: (result: MamPageResult) => void): void {
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

  publishDisplayed(peer: string, stanzaId: string, by?: string, onDone?: Done): void {
    publishDisplayed(this.transport, peer, stanzaId, by, onDone)
  }

  rttSupported(jid: string, onDone: (supported: boolean) => void): void {
    this.discoInfo(jid, undefined, (info) => {
      onDone(info?.features.includes(NS.RTT) === true)
    })
  }

  sendJingle(stanza: StanzaBuilder, onDone?: (ok: boolean) => void): void {
    sendJingleIq(this.transport, stanza, onDone)
  }
  jingleSupported(jid: string, onDone: (supported: boolean) => void): void {
    probeJingleSupport(this.transport, jid, onDone)
  }
  externalServices(onDone: (services: ExtService[]) => void): void {
    fetchExtServices(this.transport, onDone)
  }

  channelSearchForm(service: string, onDone: (form: DataForm | null) => void): void {
    channelSearchForm(this.transport, service, onDone)
  }

  channelSearch(service: string, form: DataForm, onDone: SearchDone): void {
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
