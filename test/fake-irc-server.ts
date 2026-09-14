// A scripted IRCv3-over-WebSocket server for vitest, the IRC analog
// of fake-xmpp-server.ts: CAP LS/REQ/END, SASL PLAIN, 001+005,
// JOIN/NAMES, PRIVMSG and TAGMSG relay with echo, MONITOR, AWAY
// notify, CHATHISTORY canned batches, LIST, MARKREAD and PING/PONG.
// Frames carry whole IRC lines, not single bytes.

import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'

import { parseLine, type IrcLine } from '../src/lib/core/irc/line'

const SERVER = 'fake.irc'
const CAP_LIST =
  'sasl server-time echo-message message-tags batch labeled-response ' +
  'account-tag extended-join away-notify invite-notify multi-prefix ' +
  'userhost-in-names draft/chathistory draft/read-marker draft/multiline'

export interface FakeIrcClient {
  socket: WebSocket
  nick: string
  caps: Set<string>
  channels: Set<string>
  monitors: Set<string>
}

export interface FakeIrcServerOptions {
  // SASL PLAIN is answered with 904 instead of 903
  rejectAuth?: boolean
  // send N 433 replies to pre-registration NICK before accepting
  nickCollisions?: number
  // msgids seeded into the canned chathistory batch
  historyMessages?: number
}

function userhost(nick: string): string {
  return `${nick}!u@h`
}

export class FakeIrcServer {
  readonly url: Promise<string>
  readonly clients = new Set<FakeIrcClient>()
  private readonly wss: WebSocketServer
  private msgid = 0
  private collisionCount = 0

  constructor(private readonly options: FakeIrcServerOptions = {}) {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    this.wss = wss
    this.url = new Promise((resolve, reject) => {
      wss.once('listening', () => {
        const addr = wss.address()
        const port = typeof addr === 'object' && addr !== null ? addr.port : 0
        resolve(`ws://127.0.0.1:${port}`)
      })
      wss.once('error', reject)
      wss.on('connection', (socket) => this.onConnection(socket))
    })
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.socket.terminate()
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }

  find(nick: string): FakeIrcClient | undefined {
    return [...this.clients].find((c) => c.nick.toLowerCase() === nick.toLowerCase())
  }

  private send(client: FakeIrcClient, line: string): void {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(`${line}\r\n`)
  }

  private onConnection(socket: WebSocket): void {
    const client: FakeIrcClient = {
      socket,
      nick: '',
      caps: new Set(),
      channels: new Set(),
      monitors: new Set()
    }
    this.clients.add(client)
    socket.on('message', (data) => {
      for (const raw of String(data).split('\r\n')) {
        const line = parseLine(raw)
        if (line) this.onLine(client, line)
      }
    })
    socket.on('close', () => this.onQuit(client, 'connection closed'))
  }

  private onLine(client: FakeIrcClient, line: IrcLine): void {
    switch (line.command) {
      case 'CAP':
        this.onCap(client, line)
        break
      case 'AUTHENTICATE':
        this.onAuthenticate(client, line)
        break
      case 'NICK':
        this.onNick(client, line.params[0] ?? line.text)
        break
      case 'USER':
        break
      case 'PING':
        this.send(client, `:${SERVER} PONG ${SERVER} :${line.text}`)
        break
      case 'JOIN':
        this.onJoin(client, line.params[0] ?? '')
        break
      case 'PART':
        this.onPart(client, line.params[0] ?? '')
        break
      case 'PRIVMSG':
      case 'TAGMSG':
        this.onRelay(client, line)
        break
      case 'MONITOR':
        this.onMonitor(client, line)
        break
      case 'AWAY': {
        const suffix = line.text ? ` :${line.text}` : ''
        this.notifyMonitors(client, `:${userhost(client.nick)} AWAY${suffix}`)
        break
      }
      case 'CHATHISTORY':
        this.onChathistory(client, line)
        break
      case 'LIST': {
        const needle = (line.params[0] ?? '').replace(/[*?]/g, '').toLowerCase()
        const counts = new Map<string, number>()
        for (const member of this.clients)
          for (const channel of member.channels) counts.set(channel, (counts.get(channel) ?? 0) + 1)
        for (const [channel, users] of counts)
          if (!needle || channel.toLowerCase().includes(needle))
            this.send(client, `:${SERVER} 322 ${client.nick} ${channel} ${users} :dev chan`)
        this.send(client, `:${SERVER} 323 ${client.nick} :End of LIST`)
        break
      }
      case 'MARKREAD': {
        const peer = this.find(line.params[0] ?? '')
        if (peer) this.send(peer, `:${userhost(client.nick)} MARKREAD ${line.params.join(' ')}`)
        break
      }
      case 'QUIT':
        this.onQuit(client, line.text || 'quit')
        client.socket.close()
        break
    }
  }

  private onCap(client: FakeIrcClient, line: IrcLine): void {
    const sub = line.params[0]?.toUpperCase()
    if (sub === 'LS') {
      this.send(client, `:${SERVER} CAP * LS :${CAP_LIST}`)
    } else if (sub === 'REQ') {
      for (const cap of line.text.split(/\s+/).filter(Boolean)) client.caps.add(cap)
      this.send(client, `:${SERVER} CAP * ACK :${line.text}`)
    } else if (sub === 'END') {
      this.welcome(client)
    }
  }

  private onAuthenticate(client: FakeIrcClient, line: IrcLine): void {
    const arg = line.params[0]
    if (arg === 'PLAIN') {
      this.send(client, 'AUTHENTICATE +')
      return
    }
    // any other arg is the base64 payload or a continuation chunk
    if (this.options.rejectAuth) {
      this.send(client, `:${SERVER} 904 ${client.nick || '*'} :SASL authentication failed`)
      return
    }
    this.send(client, `:${SERVER} 903 ${client.nick || '*'} :SASL authentication successful`)
    this.send(client, `:${SERVER} CAP * ACK :sasl`)
  }

  private onNick(client: FakeIrcClient, nick: string): void {
    if (!client.nick) {
      if (this.collisionCount++ < (this.options.nickCollisions ?? 0)) {
        this.send(client, `:${SERVER} 433 * ${nick} :Nickname is already in use`)
        return
      }
      client.nick = nick
      return
    }
    const old = userhost(client.nick)
    client.nick = nick
    this.broadcast(client, `:${old} NICK ${nick}`, true)
  }

  private welcome(client: FakeIrcClient): void {
    const n = client.nick || 'guest'
    this.send(client, `:${SERVER} 001 ${n} :Welcome to FakeNet`)
    this.send(
      client,
      `:${SERVER} 005 ${n} CHANTYPES=#& PREFIX=(ov)@+ CASEMAPPING=rfc1459 NETWORK=FakeNet MONITOR=100 CHATHISTORY=100 :are supported by this server`
    )
    this.send(client, `:${SERVER} 376 ${n} :End of MOTD`)
    for (const watcher of this.clients)
      if (watcher !== client && watcher.monitors.has(n.toLowerCase()))
        this.send(watcher, `:${SERVER} 730 ${watcher.nick} :${userhost(n)}`)
  }

  private onJoin(client: FakeIrcClient, channel: string): void {
    client.channels.add(channel)
    this.broadcast(client, `:${userhost(client.nick)} JOIN :${channel}`, true)
    const names = [...this.clients]
      .filter((c) => c.channels.has(channel))
      .map((c) => (c === client ? `@${c.nick}` : c.nick))
      .join(' ')
    this.send(client, `:${SERVER} 353 ${client.nick} = ${channel} :${names}`)
    this.send(client, `:${SERVER} 366 ${client.nick} ${channel} :End of NAMES`)
  }

  private onPart(client: FakeIrcClient, channel: string): void {
    client.channels.delete(channel)
    this.broadcast(client, `:${userhost(client.nick)} PART ${channel}`, true)
  }

  private onRelay(client: FakeIrcClient, line: IrcLine): void {
    const target = line.params[0] ?? ''
    const tags: string[] = [`msgid=m${++this.msgid}`, `time=${new Date().toISOString()}`]
    if (line.tags['label'] && client.caps.has('labeled-response')) {
      tags.push(`label=${line.tags['label']}`)
    }
    const tagged = (t: string[]) => `@${t.join(';')} `
    const payload = `${line.command} ${target}${line.command === 'PRIVMSG' ? ` :${line.text}` : ''}`
    const isChannel = target.startsWith('#')
    const peer = isChannel ? undefined : this.find(target)
    const receivers = isChannel
      ? [...this.clients].filter((c) => c.channels.has(target))
      : [peer, client].filter((c): c is FakeIrcClient => c !== undefined)
    for (const receiver of new Set(receivers)) {
      if (receiver === client && !client.caps.has('echo-message')) continue
      this.send(receiver, `${tagged(tags)}:${userhost(client.nick)} ${payload}`)
    }
    if (!isChannel && !peer) {
      this.send(client, `${tagged(tags)}:${SERVER} 401 ${client.nick} ${target} :No such nick`)
    }
  }

  private onMonitor(client: FakeIrcClient, line: IrcLine): void {
    const flag = line.params[0] ?? ''
    const nicks = (line.text || line.params.slice(1).join(',')).split(',').filter(Boolean)
    if (flag === '+') {
      const online: string[] = []
      for (const nick of nicks) {
        client.monitors.add(nick.toLowerCase())
        if (this.find(nick)) online.push(userhost(nick))
      }
      if (online.length > 0) this.send(client, `:${SERVER} 730 ${client.nick} :${online.join(',')}`)
    } else if (flag === '-') {
      for (const nick of nicks) client.monitors.delete(nick.toLowerCase())
    }
  }

  private notifyMonitors(client: FakeIrcClient, line: string): void {
    for (const watcher of this.clients) {
      if (watcher.monitors.has(client.nick.toLowerCase())) this.send(watcher, line)
    }
  }

  private onChathistory(client: FakeIrcClient, line: IrcLine): void {
    const target = line.params[1] ?? ''
    const ref = `h${++this.msgid}`
    const count = this.options.historyMessages ?? 2
    this.send(client, `:${SERVER} BATCH +${ref} chathistory ${target}`)
    for (let i = 0; i < count; i++) {
      const stamp = new Date(Date.now() - (count - i) * 60_000).toISOString()
      this.send(
        client,
        `@batch=${ref};msgid=h${ref}-${i};time=${stamp} :history${i}!u@h PRIVMSG ${target} :canned ${i}`
      )
    }
    this.send(client, `:${SERVER} BATCH -${ref}`)
  }

  private broadcast(client: FakeIrcClient, line: string, includeSelf: boolean): void {
    const seen = new Set<FakeIrcClient>()
    for (const channel of client.channels)
      for (const member of this.clients) {
        if (!member.channels.has(channel) || seen.has(member)) continue
        seen.add(member)
        if (member === client && !includeSelf) continue
        this.send(member, line)
      }
    if (includeSelf && client.channels.size === 0) this.send(client, line)
  }

  private onQuit(client: FakeIrcClient, reason: string): void {
    if (!this.clients.has(client)) return
    this.broadcast(client, `:${userhost(client.nick)} QUIT :${reason}`, false)
    for (const watcher of this.clients)
      if (watcher.monitors.has(client.nick.toLowerCase()))
        this.send(watcher, `:${SERVER} 731 ${watcher.nick} :${client.nick}`)
    this.clients.delete(client)
  }
}
