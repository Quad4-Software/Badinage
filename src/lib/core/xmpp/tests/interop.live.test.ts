// Live interop against a real XMPP server. Runs only when
// XMPP_INTEROP_WS points at a websocket listener, e.g. the docker dev
// stack or the CI matrix:
//   XMPP_INTEROP_WS=ws://localhost:5280/xmpp-websocket pnpm vitest run interop.live
//
// Users are created through XEP-0077 in-band registration so the suite
// is self-contained: prosody, ejabberd and openfire all accept it in
// the dev configs. Conflict on a leftover account is fine.

import { afterEach, describe, expect, it } from 'vitest'

import { XmppConnection } from '../connection'
import { RegisterError, registerAccount } from '../register'
import { servicesToIceServers, type ExtService } from '../jingle/extdisco'
import { jingleIq } from '../jingle/stanzas'
import type { JinglePacket } from '../jingle/types'
import type { ConnectionStatus } from '../types'
import type { IncomingMessage, MucOccupant } from '../stanzas'

const WS = process.env.XMPP_INTEROP_WS ?? ''
const DOMAIN = process.env.XMPP_INTEROP_DOMAIN ?? 'localhost'
const MUC = process.env.XMPP_INTEROP_MUC ?? `conference.${DOMAIN}`
// SASL ANONYMOUS domain, when the server offers it: prosody and
// ejabberd isolate it on anon.localhost, openfire allows it on the
// main domain
const ANON = process.env.XMPP_INTEROP_ANON ?? ''
// set when the server under test advertises XEP-0215 services
const EXTDISCO = process.env.XMPP_INTEROP_EXTDISCO === '1'
const PASS = 'interop-pass'
const TIMEOUT = 20_000

describe.skipIf(!WS)('XmppConnection interop', () => {
  const conns: XmppConnection[] = []
  const run = Date.now().toString(36)
  const alice = `alice-${run}`
  const bob = `bob-${run}`

  afterEach(() => {
    for (const conn of conns.splice(0)) conn.disconnect()
  })

  function nextStatus(conn: XmppConnection, want: ConnectionStatus): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`status ${want} timed out`)), TIMEOUT)
      const off = conn.events.on('status', (s) => {
        if (s === want) {
          clearTimeout(timer)
          off()
          resolve()
        }
      })
    })
  }

  function nextMessage(conn: XmppConnection, body: string): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('message timed out')), TIMEOUT)
      const off = conn.events.on('message', (message) => {
        if (message.body === body) {
          clearTimeout(timer)
          off()
          resolve(message)
        }
      })
    })
  }

  // resolves on the occupant update that carries our own nick - the
  // join handshake has completed once self-presence lands. A fresh
  // room stays locked until the owner accepts the instant-room
  // defaults, and servers answer an early second join with a presence
  // error, so joins retry briefly on that path
  function join(conn: XmppConnection, room: string, nick: string): Promise<MucOccupant> {
    return new Promise((resolve, reject) => {
      let retrying: ReturnType<typeof setTimeout> | undefined
      const giveUp = (error: Error) => {
        clearTimeout(retrying)
        clearTimeout(timer)
        offOcc()
        offErr()
        reject(error)
      }
      const timer = setTimeout(() => giveUp(new Error('join timed out')), TIMEOUT)
      const offOcc = conn.events.on('occupant', (occupant) => {
        if (occupant.room === room && occupant.nick === nick) {
          clearTimeout(timer)
          clearTimeout(retrying)
          offOcc()
          offErr()
          resolve(occupant)
        }
      })
      const offErr = conn.events.on('presenceError', (error) => {
        if (error.from === room || error.from === `${room}/${nick}`) {
          retrying = setTimeout(() => conn.joinRoom(room, nick), 400)
        }
      })
      conn.joinRoom(room, nick)
    })
  }

  async function client(user: string): Promise<XmppConnection> {
    await registerAccount(WS, `${user}@${DOMAIN}`, PASS).catch((error: unknown) => {
      if (!(error instanceof RegisterError && error.reason === 'conflict')) throw error
    })
    const conn = new XmppConnection(WS)
    conns.push(conn)
    const ready = nextStatus(conn, 'connected')
    conn.connect(`${user}@${DOMAIN}/interop`, PASS)
    await ready
    return conn
  }

  it('exchanges a direct message', { timeout: 40_000 }, async () => {
    const a = await client(alice)
    const b = await client(bob)
    const body = `hi bob ${run}`
    const inbound = nextMessage(b, body)
    a.sendChatMessage(`${bob}@${DOMAIN}`, body, 'chat')
    const message = await inbound
    expect(message.type).toBe('chat')
    expect(message.from).toContain(`${alice}@${DOMAIN}`)
  })

  it.skipIf(!ANON)('connects anonymously', { timeout: 40_000 }, async () => {
    const conn = new XmppConnection(WS)
    conns.push(conn)
    const ready = nextStatus(conn, 'connected')
    conn.connect(ANON, '')
    await ready
  })

  it('meets in a muc room', { timeout: 40_000 }, async () => {
    const a = await client(alice)
    const b = await client(bob)
    const room = `interop-${run}@${MUC}`
    // a creates the room: it starts locked until the owner accepts the
    // instant-room defaults, so b joins behind a's self-presence and
    // retries through the lock window
    await join(a, room, 'a')
    await join(b, room, 'b')

    const body = `hi room ${run}`
    const inbound = nextMessage(b, body)
    a.sendChatMessage(room, body, 'groupchat')
    const message = await inbound
    expect(message.type).toBe('groupchat')
    expect(message.from).toBe(`${room}/a`)
  })

  it('delivers a jingle session-initiate between clients', { timeout: 40_000 }, async () => {
    const a = await client(alice)
    const b = await client(bob)
    const received = new Promise<JinglePacket>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('jingle timed out')), TIMEOUT)
      const off = b.events.on('jingle', (packet) => {
        if (packet.action === 'session-initiate') {
          clearTimeout(timer)
          off()
          resolve(packet)
        }
      })
    })
    // jingle needs a full jid: the interop resource is fixed in client()
    const acked = new Promise<boolean>((resolve) => {
      a.sendJingle?.(
        jingleIq(a, `${bob}@${DOMAIN}/interop`, {
          action: 'session-initiate',
          sid: `s-${run}`,
          initiator: `${alice}@${DOMAIN}/interop`,
          contents: [
            {
              name: '0',
              media: 'audio',
              creator: 'initiator',
              senders: 'both',
              payloads: [{ id: '111', name: 'opus', clockrate: '48000' }],
              transport: { ufrag: 'u', pwd: 'p', candidates: [] }
            }
          ]
        }),
        resolve
      )
    })
    const packet = await received
    expect(packet.sid).toBe(`s-${run}`)
    expect(packet.from).toBe(`${alice}@${DOMAIN}/interop`)
    // the responder acked the iq: our jingle handler replied result
    expect(await acked).toBe(true)
  })

  it.skipIf(!EXTDISCO)('discovers stun services over XEP-0215', { timeout: 40_000 }, async () => {
    const a = await client(alice)
    const services = await new Promise<ExtService[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('extdisco timed out')), TIMEOUT)
      a.externalServices?.((found) => {
        clearTimeout(timer)
        resolve(found)
      })
    })
    expect(services.length).toBeGreaterThan(0)
    const ice = servicesToIceServers(services)
    expect(ice.some((s) => String(s.urls).startsWith('stun:'))).toBe(true)
  })
})
