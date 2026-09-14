// Link layer: owns the WebSocket, the registration session, keepalive
// pings and reconnect backoff. Everything that is not transport
// bookkeeping is handed to the connection through hooks.

import { PING_INTERVAL_MS, RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS } from '$lib/constants'

import { RPL_ISUPPORT, RPL_LIST, RPL_LISTEND } from './address'
import { parseLine, type IrcLine } from './line'
import { IrcSession } from './session'

// one row of a LIST reply: channel, user count, topic
export interface ListReply {
  channel: string
  users: number
  topic: string
}

export interface LinkHooks {
  // a parsed line that survived transport handling. Session commands
  // are fed to the session first, so this sees post-registration
  // traffic plus numerics the session ignores
  onLine(line: IrcLine): void
  onRegistered(nick: string): void
  // authfail and error are terminal for this socket. Disconnected
  // follows a clean or dirty close after registration
  onStatus(status: 'authfail' | 'error' | 'disconnected'): void
  onIsupport(params: string[]): void
  onLatency(ms: number): void
}

export class IrcLink {
  private ws: WebSocket | undefined
  private session: IrcSession | undefined
  private manualDisconnect = false
  private reconnectDelay = RECONNECT_DELAY_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private pingTimer: ReturnType<typeof setInterval> | undefined
  private pingSent = 0
  private lastInbound = 0
  private loginNick = ''
  private password = ''
  // sasl mechanism choice: oauth swaps PLAIN for OAUTHBEARER and the
  // password slot carries the token. Persisted so reconnects reuse it
  private oauth = false
  private wasRegistered = false
  private listDone: ((items: ListReply[] | null) => void) | null = null
  private listItems: ListReply[] = []

  constructor(
    private readonly service: string,
    private readonly hooks: LinkHooks
  ) {}

  get connected(): boolean {
    return this.session?.registered === true && this.ws?.readyState === WebSocket.OPEN
  }

  get nick(): string {
    return this.session?.currentNick ?? this.loginNick
  }

  caps(): ReadonlySet<string> {
    return this.session?.caps ?? new Set()
  }

  send(line: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(`${line}\r\n`)
  }

  // one LIST in flight: replies carry no request id, so concurrent
  // queries cannot be told apart. False when busy or unregistered
  listChannels(mask: string | undefined, onDone: (items: ListReply[] | null) => void): boolean {
    if (this.listDone || !this.connected) return false
    this.listDone = onDone
    this.listItems = []
    this.send(mask ? `LIST ${mask}` : 'LIST')
    return true
  }

  private finishList(items: ListReply[] | null): void {
    const done = this.listDone
    this.listDone = null
    this.listItems = []
    done?.(items)
  }

  connect(nick: string, password: string, oauth = false): void {
    this.manualDisconnect = false
    this.loginNick = nick
    this.password = password
    this.oauth = oauth
    let ws: WebSocket
    try {
      ws = new WebSocket(this.service)
    } catch {
      this.hooks.onStatus('error')
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.session = new IrcSession(
        this.loginNick,
        this.password,
        {
          send: (line) => this.send(line),
          onRegistered: (n) => {
            this.wasRegistered = true
            this.reconnectDelay = RECONNECT_DELAY_MS
            this.startPing()
            this.hooks.onRegistered(n)
          },
          onAuthFail: () => {
            this.hooks.onStatus('authfail')
            ws.close()
          },
          onError: () => {
            this.hooks.onStatus('error')
            ws.close()
          }
        },
        { oauth: this.oauth }
      )
      this.session.start()
    }
    ws.onmessage = (event) => this.onData(String(event.data))
    ws.onclose = () => this.onClosed()
    ws.onerror = () => undefined
  }

  disconnect(): void {
    this.manualDisconnect = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.stopPing()
    if (this.ws?.readyState === WebSocket.OPEN) this.send('QUIT :Badinage')
    this.ws?.close()
  }

  private onData(data: string): void {
    this.lastInbound = Date.now()
    for (const raw of data.split('\r\n')) {
      const line = parseLine(raw)
      if (!line) continue
      if (line.command === 'PING') {
        this.send(`PONG :${line.text}`)
        continue
      }
      if (line.command === 'PONG') {
        if (this.pingSent > 0) this.hooks.onLatency(Date.now() - this.pingSent)
        continue
      }
      if (line.command === RPL_ISUPPORT) {
        this.hooks.onIsupport(line.params.slice(1))
        continue
      }
      // 322 me #chan 12 :topic. Feeding these to the session or the
      // dispatcher would do nothing, so the reply ends here
      if (line.command === RPL_LIST) {
        const channel = line.params[1]
        if (channel) {
          this.listItems.push({
            channel,
            users: Number.parseInt(line.params[2] ?? '', 10) || 0,
            topic: line.text
          })
        }
        continue
      }
      if (line.command === RPL_LISTEND) {
        this.finishList(this.listItems)
        continue
      }
      this.session?.handle(line)
      this.hooks.onLine(line)
    }
  }

  private onClosed(): void {
    this.stopPing()
    const wasRegistered = this.wasRegistered
    this.wasRegistered = false
    this.session = undefined
    this.ws = undefined
    this.finishList(null)
    if (!wasRegistered && !this.manualDisconnect) {
      // never got through registration: surface a connect error rather
      // than a silent drop so the login form can report it
      this.hooks.onStatus('error')
      return
    }
    this.hooks.onStatus('disconnected')
    if (this.manualDisconnect) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (!this.manualDisconnect && !this.connected) {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_DELAY_MAX_MS)
        this.connect(this.loginNick, this.password, this.oauth)
      }
    }, this.reconnectDelay)
  }

  private startPing(): void {
    this.stopPing()
    this.lastInbound = Date.now()
    this.pingTimer = setInterval(() => {
      if (!this.connected || Date.now() - this.lastInbound < PING_INTERVAL_MS) return
      this.pingSent = Date.now()
      this.send(`PING :${this.pingSent}`)
    }, PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = undefined
  }
}
