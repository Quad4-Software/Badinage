// A scripted XMPP-over-WebSocket server (RFC 7395 subset) for vitest.
// Implements just enough of the stream handshake for a real
// Strophe.Connection to reach CONNECTED: <open/>, SASL PLAIN, the stream
// restart after auth, and resource binding. Incoming frames are parsed
// leniently with regexes; each websocket frame carries one stanza.

import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'

const NS_FRAMING = 'urn:ietf:params:xml:ns:xmpp-framing'
const NS_STREAM = 'http://etherx.jabber.org/streams'
const NS_SASL = 'urn:ietf:params:xml:ns:xmpp-sasl'
const NS_BIND = 'urn:ietf:params:xml:ns:xmpp-bind'
const NS_ROSTER = 'jabber:iq:roster'

export interface RosterSeed {
  jid: string
  name?: string
  subscription?: string
  groups?: string[]
}

export interface FakeXmppServerOptions {
  // SASL PLAIN is answered with a failure instead of success
  rejectAuth?: boolean
  // items returned in the roster get result
  rosterItems?: RosterSeed[]
  // custom iq responder, consulted after binding; return xml to send, or
  // null to fall through to the default handling
  respond?: (stanza: string) => string | null
}

function attr(raw: string, name: string): string | null {
  const match = new RegExp(`\\b${name}=["']([^"']*)["']`).exec(raw)
  return match?.[1] ?? null
}

function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function rosterItemXml(item: RosterSeed): string {
  let xml = `<item jid='${esc(item.jid)}'`
  if (item.name) xml += ` name='${esc(item.name)}'`
  xml += ` subscription='${esc(item.subscription ?? 'both')}'`
  if (!item.groups?.length) return `${xml}/>`
  return `${xml}>${item.groups.map((g) => `<group>${esc(g)}</group>`).join('')}</item>`
}

export class FakeXmppServer {
  // resolves once the socket is listening and url is usable
  readonly ready: Promise<void>

  private readonly wss: WebSocketServer
  private readonly opts: FakeXmppServerOptions
  private socket: WebSocket | null = null
  private readonly frames: string[] = []
  private streamSeq = 0

  constructor(opts: FakeXmppServerOptions = {}) {
    this.opts = opts
    this.wss = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      // strophe always offers the 'xmpp' subprotocol
      handleProtocols: (protocols) => (protocols.has('xmpp') ? 'xmpp' : false)
    })
    this.ready = new Promise((resolve, reject) => {
      this.wss.once('listening', () => resolve())
      this.wss.once('error', reject)
    })
    this.wss.on('connection', (socket) => this.onConnection(socket))
  }

  get url(): string {
    const addr = this.wss.address()
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0
    return `ws://127.0.0.1:${port}`
  }

  // every stanza the client has sent, in order
  received(): string[] {
    return [...this.frames]
  }

  // push a raw stanza down to the client
  send(rawXml: string): void {
    this.socket?.send(rawXml)
  }

  // drop the current client socket (server-initiated disconnect)
  close(): void {
    this.socket?.close()
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.wss.clients) client.terminate()
      this.wss.close(() => resolve())
    })
  }

  private onConnection(socket: WebSocket): void {
    this.socket = socket
    // the stream restarts after SASL, so the second <open> must be
    // answered with the bind feature instead of mechanisms
    let authed = false
    let domain = 'example.net'
    let bareJid = ''

    socket.on('message', (data) => {
      const raw = String(data)
      this.frames.push(raw)

      if (raw.startsWith('<open')) {
        domain = attr(raw, 'to') ?? domain
        this.streamSeq += 1
        socket.send(
          `<open xmlns='${NS_FRAMING}' from='${domain}' id='s${this.streamSeq}' version='1.0'/>`
        )
        socket.send(authed ? this.bindFeatures() : this.saslFeatures())
        return
      }

      if (raw.startsWith('<auth')) {
        if (this.opts.rejectAuth) {
          socket.send(`<failure xmlns='${NS_SASL}'><not-authorized/></failure>`)
          socket.close()
          return
        }
        bareJid = this.decodePlainAuth(raw, domain)
        authed = true
        socket.send(`<success xmlns='${NS_SASL}'/>`)
        return
      }

      if (raw.startsWith('<iq')) {
        this.onIq(raw, socket, bareJid)
        return
      }

      if (raw.startsWith('<close')) {
        socket.close()
      }
    })

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
    })
  }

  private saslFeatures(): string {
    return (
      `<stream:features xmlns:stream='${NS_STREAM}'>` +
      `<mechanisms xmlns='${NS_SASL}'><mechanism>PLAIN</mechanism></mechanisms>` +
      `</stream:features>`
    )
  }

  private bindFeatures(): string {
    return (
      `<stream:features xmlns:stream='${NS_STREAM}'>` +
      `<bind xmlns='${NS_BIND}'/>` +
      `</stream:features>`
    )
  }

  // SASL PLAIN payload is base64 of authzid NUL authcid NUL password
  private decodePlainAuth(raw: string, domain: string): string {
    const payload = /<auth[^>]*>([^<]*)<\/auth>/.exec(raw)?.[1] ?? ''
    const parts = atob(payload).split('\0')
    const authcid = parts[1] ?? 'user'
    return `${authcid}@${domain}`
  }

  private onIq(raw: string, socket: WebSocket, bareJid: string): void {
    const id = attr(raw, 'id') ?? ''

    if (raw.includes(NS_BIND)) {
      const resource = /<resource>([^<]*)<\/resource>/.exec(raw)?.[1] ?? 'res'
      const jid = `${bareJid}/${resource}`
      socket.send(
        `<iq type='result' id='${esc(id)}'>` +
          `<bind xmlns='${NS_BIND}'><jid>${esc(jid)}</jid></bind>` +
          `</iq>`
      )
      return
    }

    const custom = this.opts.respond?.(raw)
    if (custom) {
      socket.send(custom)
      return
    }

    if (raw.includes(NS_ROSTER)) {
      const items = (this.opts.rosterItems ?? []).map(rosterItemXml).join('')
      socket.send(
        `<iq type='result' id='${esc(id)}'>` +
          `<query xmlns='${NS_ROSTER}'>${items}</query>` +
          `</iq>`
      )
      return
    }

    socket.send(`<iq type='result' id='${esc(id)}'/>`)
  }
}
