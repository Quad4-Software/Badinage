// Live interop against a real Ergo ircd. Runs only when ERGO_WS points at
// an Ergo websocket listener, e.g. the docker dev stack:
//   docker compose -f docker/dev/compose.yaml up ergo
//   ERGO_WS=ws://localhost:8097 pnpm vitest run ergo.live

import { afterEach, describe, expect, it } from 'vitest'

import type { IncomingMessage } from '../../xmpp/stanzas'
import type { ConnectionStatus } from '../../xmpp/types'
import { IrcConnection } from '../connection'

const ERGO_WS = process.env.ERGO_WS ?? ''
const DOMAIN = new URL(ERGO_WS || 'ws://x.invalid').hostname || 'irc.badinage.test'

describe.skipIf(!ERGO_WS)('IrcConnection against Ergo', () => {
  const conns: IrcConnection[] = []
  const socks: WebSocket[] = []

  afterEach(() => {
    for (const conn of conns.splice(0)) conn.disconnect()
    for (const sock of socks.splice(0)) sock.close()
  })

  function nextStatus(conn: IrcConnection, want: ConnectionStatus): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`status ${want} timed out`)), 15_000)
      const off = conn.events.on('status', (s) => {
        if (s === want) {
          clearTimeout(timer)
          off()
          resolve()
        }
      })
    })
  }

  async function client(nick: string, password = ''): Promise<IrcConnection> {
    const conn = new IrcConnection(ERGO_WS, DOMAIN, { persist: false })
    conns.push(conn)
    const ready = nextStatus(conn, 'connected')
    conn.connect(`${nick}@${DOMAIN}`, password)
    await ready
    return conn
  }

  // a raw websocket client for server commands our transport does not
  // expose, like NickServ REGISTER. Resolves when an inbound line
  // contains the want substring
  function rawClient(nick: string, lines: string[], want: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(ERGO_WS)
      socks.push(ws)
      const received: string[] = []
      const timer = setTimeout(() => reject(new Error('raw client timed out')), 15_000)
      ws.onopen = () => {
        // ergo treats each websocket frame as exactly one irc line
        ws.send('CAP LS 302\r\n')
        ws.send(`NICK ${nick}\r\n`)
        ws.send('USER t 0 * :t\r\n')
        ws.send('CAP END\r\n')
      }
      ws.onmessage = (event) => {
        for (const raw of String(event.data).split('\r\n')) {
          if (!raw) continue
          received.push(raw)
          if (raw.includes(' 001 ')) {
            for (const line of lines) ws.send(`${line}\r\n`)
          }
          if (raw.includes(want)) {
            clearTimeout(timer)
            resolve(received)
          }
        }
      }
      ws.onerror = () => reject(new Error('raw client socket error'))
    })
  }

  it('registers and reports negotiated caps', async () => {
    const conn = await client(`anon${Date.now() % 100000}`)
    expect(conn.caps().has('draft/chathistory')).toBe(true)
    expect(conn.caps().has('echo-message')).toBe(true)
    expect(conn.caps().has('server-time')).toBe(true)
  })

  it('authenticates over SASL after NickServ registration', { timeout: 30_000 }, async () => {
    const nick = `sasl${Date.now() % 100000}`
    await rawClient(nick, ['NS REGISTER testpass1'], 'Account created')
    const conn = await client(nick, 'testpass1')
    expect(conn.jid).toBe(`${nick}@${DOMAIN}`)
  })

  it('reports authfail on a bad SASL password', { timeout: 30_000 }, async () => {
    const nick = `bad${Date.now() % 100000}`
    await rawClient(nick, ['NS REGISTER rightpass'], 'Account created')
    const conn = new IrcConnection(ERGO_WS, DOMAIN, { persist: false })
    conns.push(conn)
    const failed = nextStatus(conn, 'authfail')
    conn.connect(`${nick}@${DOMAIN}`, 'wrongpass')
    await failed
  })

  it('exchanges channel messages between two clients', async () => {
    const room = `#ergo-test${Date.now() % 10000}`
    const a = await client(`alice${Date.now() % 100000}`)
    const b = await client(`bob${Date.now() % 100000}`)
    a.joinRoom(`${room}@${DOMAIN}`, 'x')
    b.joinRoom(`${room}@${DOMAIN}`, 'y')
    await new Promise((r) => setTimeout(r, 300))
    const seen = new Promise<IncomingMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no channel message')), 10_000)
      a.events.on('message', (m) => {
        if (m.type === 'groupchat' && m.body === 'interop hello') {
          clearTimeout(timer)
          resolve(m)
        }
      })
    })
    b.sendChatMessage(`${room}@${DOMAIN}`, 'interop hello')
    const m = await seen
    expect(m.from).toContain(room.toLowerCase())
  })

  it('returns server history for a channel', async () => {
    const room = `#ergo-hist${Date.now() % 10000}`
    const a = await client(`hist${Date.now() % 100000}`)
    a.joinRoom(`${room}@${DOMAIN}`, 'x')
    await new Promise((r) => setTimeout(r, 300))
    a.sendChatMessage(`${room}@${DOMAIN}`, 'stored one')
    a.sendChatMessage(`${room}@${DOMAIN}`, 'stored two')
    await new Promise((r) => setTimeout(r, 300))
    const seen: string[] = []
    a.events.on('message', (m) => {
      if (m.body.startsWith('stored')) seen.push(m.body)
    })
    const page = await new Promise<{ complete: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('archive timed out')), 10_000)
      a.queryArchive(`${room}@${DOMAIN}`, { room: true }, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
    })
    expect(page.complete).toBe(true)
    expect(seen).toContain('stored one')
    expect(seen).toContain('stored two')
  })

  it('delivers direct messages', async () => {
    const a = await client(`dmsrc${Date.now() % 100000}`)
    const b = await client(`dmdst${Date.now() % 100000}`)
    const dstNick = b.jid.split('@')[0] ?? ''
    const seen = new Promise<IncomingMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no dm')), 10_000)
      b.events.on('message', (m) => {
        if (m.type === 'chat' && m.body === 'dm hello') {
          clearTimeout(timer)
          resolve(m)
        }
      })
    })
    a.sendChatMessage(`${dstNick}@${DOMAIN}`, 'dm hello')
    await seen
  })
})
