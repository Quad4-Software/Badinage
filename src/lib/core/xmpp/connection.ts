import { $iq, $msg, $pres, Strophe } from 'strophe.js'

import { RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS } from '$lib/constants'
import { Emitter } from '$lib/core/events'
import { bareJid } from '$lib/utils/jid'

import { NS } from './ns'

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'authfail' | 'error'

export interface RosterItem {
  jid: string
  name: string
  subscription: string
  groups: string[]
}

export interface IncomingMessage {
  from: string
  to: string
  body: string
  stanzaId?: string
  delay?: number
}

export interface PresenceUpdate {
  from: string
  show: string
  status: string
}

type ConnectionEvents = {
  status: ConnectionStatus
  message: IncomingMessage
  presence: PresenceUpdate
  roster: RosterItem[]
}

type StropheConnection = InstanceType<typeof Strophe.Connection>

export class XmppConnection {
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

  connect(jid: string, password: string): void {
    this.manualDisconnect = false
    this.conn.connect(jid, password, (status) => this.onStatus(status))
  }

  disconnect(): void {
    this.manualDisconnect = true
    this.conn.disconnect()
  }

  sendChatMessage(to: string, body: string): string {
    const id = this.conn.getUniqueId('msg')
    this.conn.send($msg({ to, type: 'chat', id }).c('body').t(body))
    return id
  }

  fetchRoster(): void {
    const iq = $iq({ type: 'get', id: this.conn.getUniqueId('roster') }).c('query', {
      xmlns: NS.ROSTER
    })
    this.conn.sendIQ(iq, (stanza) => {
      const items: RosterItem[] = []
      stanza.querySelectorAll('item').forEach((el) => {
        items.push({
          jid: el.getAttribute('jid') ?? '',
          name: el.getAttribute('name') ?? '',
          subscription: el.getAttribute('subscription') ?? 'none',
          groups: [...el.querySelectorAll('group')].map((g) => g.textContent ?? '')
        })
      })
      this.events.emit('roster', items)
    })
  }

  sendPresence(): void {
    this.conn.send($pres())
  }

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
    const body = stanza.querySelector('body')?.textContent
    if (!body) return true
    const message: IncomingMessage = {
      from: stanza.getAttribute('from') ?? '',
      to: stanza.getAttribute('to') ?? '',
      body
    }
    const stanzaId = stanza.querySelector(`stanza-id[xmlns="${NS.STANZA_IDS}"]`)
    if (stanzaId?.id) message.stanzaId = stanzaId.id
    const delay = stanza.querySelector(`delay[xmlns="${NS.DELAY}"]`)
    const stamp = delay?.getAttribute('stamp')
    if (stamp) message.delay = Date.parse(stamp)
    this.events.emit('message', message)
    return true
  }

  private onPresence(stanza: Element): boolean {
    const from = stanza.getAttribute('from')
    if (!from) return true
    const update: PresenceUpdate = {
      from: bareJid(from),
      show: stanza.querySelector('show')?.textContent ?? 'online',
      status: stanza.querySelector('status')?.textContent ?? ''
    }
    this.events.emit('presence', update)
    return true
  }
}
