import { afterEach, describe, expect, it } from 'vitest'

import { FakeIrcServer } from '../../../../../test/fake-irc-server'
import { IrcConnection } from '../connection'
import type { IncomingMessage } from '../../xmpp/stanzas'
import type { ConnectionStatus } from '../../xmpp/types'

const DOMAIN = 'fake.irc'

function nextStatus(conn: IrcConnection, want: ConnectionStatus): Promise<void> {
  return new Promise((resolve) => {
    const off = conn.events.on('status', (s) => {
      if (s === want) {
        off()
        resolve()
      }
    })
  })
}

function nextMessage(conn: IrcConnection, predicate: (m: IncomingMessage) => boolean) {
  return new Promise<IncomingMessage>((resolve) => {
    const off = conn.events.on('message', (m) => {
      if (predicate(m)) {
        off()
        resolve(m)
      }
    })
  })
}

async function makeClient(
  server: FakeIrcServer,
  nick: string,
  password = ''
): Promise<IrcConnection> {
  const conn = new IrcConnection(await server.url, DOMAIN, { persist: false })
  const ready = nextStatus(conn, 'connected')
  conn.connect(`${nick}@${DOMAIN}`, password)
  await ready
  return conn
}

describe('IrcConnection against fake ircd', () => {
  const servers: FakeIrcServer[] = []
  const conns: IrcConnection[] = []

  async function server(options = {}): Promise<FakeIrcServer> {
    const s = new FakeIrcServer(options)
    servers.push(s)
    await s.url
    return s
  }

  async function client(s: FakeIrcServer, nick: string, password = '') {
    const c = await makeClient(s, nick, password)
    conns.push(c)
    return c
  }

  afterEach(async () => {
    for (const conn of conns.splice(0)) conn.disconnect()
    for (const s of servers.splice(0)) await s.close()
  })

  it('registers and emits connected plus a roster event', async () => {
    const s = await server()
    const conn = new IrcConnection(await s.url, DOMAIN, { persist: false })
    conns.push(conn)
    const roster = new Promise<unknown[]>((resolve) => {
      conn.events.on('roster', (items) => resolve(items))
    })
    const ready = nextStatus(conn, 'connected')
    conn.connect(`alice@${DOMAIN}`, '')
    await ready
    expect(conn.jid).toBe(`alice@${DOMAIN}`)
    expect(await roster).toEqual([])
  })

  it('reports authfail when SASL is rejected', async () => {
    const s = await server({ rejectAuth: true })
    const conn = new IrcConnection(await s.url, DOMAIN, { persist: false })
    conns.push(conn)
    const failed = nextStatus(conn, 'authfail')
    conn.connect(`alice@${DOMAIN}`, 'wrong')
    await failed
  })

  it('joins a channel and reports self as occupant', async () => {
    const s = await server()
    const conn = await client(s, 'alice')
    const occupant = new Promise<{ nick: string; affiliation: string }>((resolve) => {
      conn.events.on('occupant', (o) => {
        if (o.nick === 'alice') resolve(o)
      })
    })
    conn.joinRoom(`#chan@${DOMAIN}`, 'alice')
    const o = await occupant
    expect(o.affiliation).toBeDefined()
  })

  it('exchanges channel messages between two clients', async () => {
    const s = await server()
    const a = await client(s, 'alice')
    const b = await client(s, 'bob')
    const room = `#chan@${DOMAIN}`
    a.joinRoom(room, 'alice')
    b.joinRoom(room, 'bob')
    await new Promise((r) => setTimeout(r, 50))
    const seen = nextMessage(
      a,
      (m) => m.type === 'groupchat' && m.body === 'hello channel' && m.from.startsWith('#chan@')
    )
    b.sendChatMessage(room, 'hello channel')
    const m = await seen
    expect(m.from).toContain('bob')
  })

  it('delivers a direct message to the addressed nick only', async () => {
    const s = await server()
    const a = await client(s, 'alice')
    const b = await client(s, 'bob')
    const seen = nextMessage(b, (m) => m.type === 'chat' && m.body === 'hi bob')
    a.sendChatMessage(`bob@${DOMAIN}`, 'hi bob')
    const m = await seen
    expect(m.from).toBe(`alice@${DOMAIN}`)
  })

  it('emits presence when a monitored nick comes online', async () => {
    const s = await server()
    const a = await client(s, 'alice')
    a.rosterSet(`carol@${DOMAIN}`, 'carol')
    const online = new Promise<void>((resolve) => {
      a.events.on('presence', (p) => {
        if (p.from === `carol@${DOMAIN}` && p.show !== 'xa') resolve()
      })
    })
    const carol = await client(s, 'carol')
    conns.push(carol)
    await online
  })

  it('returns canned chathistory for a channel', async () => {
    const s = await server({ historyMessages: 3 })
    const conn = await client(s, 'alice')
    const room = `#chan@${DOMAIN}`
    conn.joinRoom(room, 'alice')
    await new Promise((r) => setTimeout(r, 50))
    const seen: IncomingMessage[] = []
    conn.events.on('message', (m) => {
      if (m.body.startsWith('canned')) seen.push(m)
    })
    const page = await new Promise<{ complete: boolean }>((resolve) => {
      conn.queryArchive(room, { room: true }, (r) => resolve(r))
    })
    expect(page.complete).toBe(true)
    expect(seen).toHaveLength(3)
  })

  it('lists joined channels through channelSearch', async () => {
    const s = await server()
    const conn = await client(s, 'alice')
    conn.joinRoom(`#chan@${DOMAIN}`, 'alice')
    conn.joinRoom(`#other@${DOMAIN}`, 'alice')
    await new Promise((r) => setTimeout(r, 50))
    const items = await new Promise<unknown>((resolve) => {
      conn.channelSearch(
        DOMAIN,
        {
          fields: [
            { var: 'q', type: 'text-single', required: false, values: ['chan'], options: [] }
          ]
        },
        resolve
      )
    })
    expect(items).toEqual([expect.objectContaining({ address: `#chan@${DOMAIN}`, nusers: 1 })])
  })
})
