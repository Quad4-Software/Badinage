// Transport layer: owns the Strophe connection, reconnect backoff, and the
// event surface the rest of the app consumes. Stanza parsing lives in
// stanzas.ts, MAM in mam.ts. Keep protocol knowledge out of this file.

import { $iq, $msg, $pres, Strophe } from 'strophe.js'

import { RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS } from '$lib/constants'
import { Emitter } from '$lib/core/events'

import { NS } from './ns'
import {
  parseMessage,
  parsePresence,
  parseRosterItems,
  type ChatState,
  type IncomingMessage,
  type MarkerType,
  type MucOccupant,
  type PresenceUpdate,
  type RosterItem
} from './stanzas'

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'authfail' | 'error'

export interface SubscriptionRequest {
  from: string
  status: string
}

export interface MamPageResult {
  complete: boolean
  last?: string | undefined
}

type ConnectionEvents = {
  status: ConnectionStatus
  message: IncomingMessage
  presence: PresenceUpdate
  roster: RosterItem[]
  rosterUpdate: RosterItem
  rosterRemove: string
  subscriptionRequest: SubscriptionRequest
  occupant: MucOccupant
}

type StropheConnection = InstanceType<typeof Strophe.Connection>

function noop(): void {
  // intentional no-op for iq responses we do not need to inspect
}
type StanzaBuilder = ReturnType<typeof $msg>

// The transport surface the state layer depends on. XmppConnection is the
// real transport; DemoConnection in demo.ts is the fake one used by demo mode.
export interface ChatConnection {
  readonly events: Emitter<ConnectionEvents>
  readonly connected: boolean
  readonly jid: string
  connect(jid: string, password: string): void
  disconnect(): void
  uniqueId(prefix: string): string
  sendChatMessage(to: string, body: string, type?: 'chat' | 'groupchat'): string
  sendChatState(to: string, state: ChatState, type?: 'chat' | 'groupchat'): void
  sendReceipt(to: string, id: string): void
  sendMarker(to: string, id: string, marker: MarkerType): void
  sendPresence(show?: string, status?: string): void
  sendDirectedPresence(to: string, type?: string, status?: string): void
  fetchRoster(): void
  rosterSet(jid: string, name: string, groups?: string[]): void
  rosterRemove(jid: string): void
  joinRoom(room: string, nick: string, password?: string): void
  leaveRoom(room: string, nick: string): void
  setRoomSubject(room: string, subject: string): void
  queryArchive(
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void
  enableCarbons(): void
}

export class XmppConnection implements ChatConnection {
  readonly events = new Emitter<ConnectionEvents>()

  private conn: StropheConnection
  private reconnectDelay = RECONNECT_DELAY_MS
  private manualDisconnect = false

  constructor(private readonly service: string) {
    this.conn = new Strophe.Connection(service)
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
    this.conn.sendIQ(stanza, onResult, onError ?? noop)
  }

  // ---- messaging ----------------------------------------------------------

  sendChatMessage(to: string, body: string, type: 'chat' | 'groupchat' = 'chat'): string {
    const id = this.conn.getUniqueId('msg')
    const originId = this.conn.getUniqueId('origin')
    this.conn.send(
      $msg({ to, type, id })
        .c('body')
        .t(body)
        .up()
        .c('origin-id', { xmlns: NS.STANZA_IDS, id: originId })
        .up()
        .c('request', { xmlns: NS.RECEIPTS })
    )
    return id
  }

  sendChatState(to: string, state: ChatState, type: 'chat' | 'groupchat' = 'chat'): void {
    this.conn.send($msg({ to, type }).c(state, { xmlns: NS.CHAT_STATES }))
  }

  sendReceipt(to: string, id: string): void {
    this.conn.send($msg({ to, type: 'chat' }).c('received', { xmlns: NS.RECEIPTS, id }))
  }

  sendMarker(to: string, id: string, marker: MarkerType): void {
    this.conn.send($msg({ to, type: 'chat' }).c(marker, { xmlns: NS.MARKERS, id }))
  }

  // ---- presence / subscription -------------------------------------------

  sendPresence(show?: string, status?: string): void {
    const pres = $pres()
    if (show) pres.c('show').t(show).up()
    if (status) pres.c('status').t(status).up()
    this.conn.send(pres)
  }

  sendDirectedPresence(to: string, type?: string, status?: string): void {
    const pres = type ? $pres({ to, type }) : $pres({ to })
    if (status) pres.c('status').t(status)
    this.conn.send(pres)
  }

  // ---- roster -------------------------------------------------------------

  fetchRoster(): void {
    this.sendIq(
      $iq({ type: 'get', id: this.conn.getUniqueId('roster') }).c('query', {
        xmlns: NS.ROSTER
      }),
      (stanza) => this.events.emit('roster', parseRosterItems(stanza))
    )
  }

  rosterSet(jid: string, name: string, groups: string[] = []): void {
    const item = $iq({ type: 'set', id: this.conn.getUniqueId('roster-set') })
      .c('query', { xmlns: NS.ROSTER })
      .c('item', { jid })
    if (name) item.attrs({ name })
    for (const group of groups) item.c('group').t(group).up()
    this.sendIq(item, noop)
  }

  rosterRemove(jid: string): void {
    this.sendIq(
      $iq({ type: 'set', id: this.conn.getUniqueId('roster-del') })
        .c('query', { xmlns: NS.ROSTER })
        .c('item', { jid, subscription: 'remove' }),
      noop
    )
  }

  // ---- MUC ----------------------------------------------------------------

  joinRoom(room: string, nick: string, password?: string): void {
    const x = $pres({ to: `${room}/${nick}` }).c('x', { xmlns: NS.MUC })
    if (password) x.c('password').t(password).up()
    x.c('history', { maxstanzas: '100' })
    this.conn.send(x)
  }

  leaveRoom(room: string, nick: string): void {
    this.conn.send($pres({ to: `${room}/${nick}`, type: 'unavailable' }))
  }

  setRoomSubject(room: string, subject: string): void {
    this.conn.send($msg({ to: room, type: 'groupchat' }).c('subject').t(subject))
  }

  // ---- MAM ------------------------------------------------------------------

  // Fetches one archive page. For DMs the archive is ours filtered by 'with';
  // for rooms the iq is addressed to the room and the 'with' field is omitted.
  // Results arrive as 'message' events flagged with mam=true; onDone fires
  // when the iq result (fin) arrives.
  queryArchive(
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void {
    const id = this.conn.getUniqueId('mam')
    const attrs: Record<string, string> = { type: 'set', id }
    if (opts.room) attrs.to = peerJid
    const query = $iq(attrs).c('query', { xmlns: NS.MAM, queryid: id })
    const form = query
      .c('x', { xmlns: NS.FORMS, type: 'submit' })
      .c('field', { var: 'FORM_TYPE', type: 'hidden' })
      .c('value')
      .t(NS.MAM)
      .up()
      .up()
    if (!opts.room) {
      form.c('field', { var: 'with' }).c('value').t(peerJid).up().up()
    }
    form.up()
    const set = query.c('set', { xmlns: NS.RSM })
    set
      .c('max')
      .t(String(opts.max ?? 50))
      .up()
    if (opts.before) set.c('before').t(opts.before).up()
    this.sendIq(
      query,
      (result) => {
        const fin = result.getElementsByTagNameNS(NS.MAM, 'fin').item(0) as Element | null
        const set = fin?.getElementsByTagNameNS(NS.RSM, 'set').item(0) as Element | null
        const last = set?.getElementsByTagName('last').item(0)?.textContent
        onDone({
          complete: fin?.getAttribute('complete') === 'true',
          last: last ?? undefined
        })
      },
      () => onDone({ complete: true })
    )
  }

  enableCarbons(): void {
    this.sendIq(
      $iq({ type: 'set', id: this.conn.getUniqueId('carbons') }).c('enable', {
        xmlns: NS.CARBONS
      }),
      noop
    )
  }

  // ---- internals ------------------------------------------------------------

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
        this.events.emit('status', 'disconnected')
        if (!this.manualDisconnect) this.scheduleReconnect()
        break
    }
  }

  private onConnected(): void {
    this.conn.addHandler((stanza) => this.onMessage(stanza), null, 'message', null)
    this.conn.addHandler((stanza) => this.onPresence(stanza), null, 'presence', null)
    this.conn.addHandler((stanza) => this.onRosterPush(stanza), NS.ROSTER, 'iq', 'set')
    this.enableCarbons()
    this.sendPresence()
    this.fetchRoster()
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

  private onMessage(stanza: Element): boolean {
    const message = parseMessage(stanza)
    if (message) this.events.emit('message', message)
    return true
  }

  private onPresence(stanza: Element): boolean {
    const parsed = parsePresence(stanza)
    if (!parsed) return true
    if (parsed.kind === 'occupant') {
      this.events.emit('occupant', parsed.occupant)
    } else if (parsed.kind === 'subscribe') {
      this.events.emit('subscriptionRequest', { from: parsed.from, status: parsed.status })
    } else {
      this.events.emit('presence', parsed.presence)
    }
    return true
  }

  private onRosterPush(stanza: Element): boolean {
    for (const item of parseRosterItems(stanza)) {
      if (item.subscription === 'remove') {
        this.events.emit('rosterRemove', item.jid)
      } else {
        this.events.emit('rosterUpdate', item)
      }
    }
    // roster pushes require an empty result reply
    const from = stanza.getAttribute('from')
    const attrs: Record<string, string> = { type: 'result', id: stanza.getAttribute('id') ?? '' }
    if (from) attrs.to = from
    this.conn.send($iq(attrs))
    return true
  }
}
