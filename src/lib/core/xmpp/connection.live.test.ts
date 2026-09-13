import { afterEach, describe, expect, it } from 'vitest'

import { FakeXmppServer } from '../../../../test/fake-xmpp-server'
import { XmppConnection } from './connection'
import type { ConnectionEvents, ConnectionStatus } from './types'

function nextStatus(xmpp: XmppConnection, want: ConnectionStatus): Promise<void> {
  return new Promise((resolve) => {
    const off = xmpp.events.on('status', (s) => {
      if (s === want) {
        off()
        resolve()
      }
    })
  })
}

function nextEvent<K extends keyof ConnectionEvents>(
  xmpp: XmppConnection,
  event: K
): Promise<ConnectionEvents[K]> {
  return new Promise((resolve) => {
    const off = xmpp.events.on(event, (payload) => {
      off()
      resolve(payload)
    })
  })
}

describe('XmppConnection over a live fake xmpp server', () => {
  let server: FakeXmppServer | undefined
  let xmpp: XmppConnection | undefined

  afterEach(async () => {
    xmpp?.disconnect()
    await server?.stop()
    xmpp = undefined
    server = undefined
  })

  function connectedXmpp(): Promise<void> {
    if (!server) throw new Error('server not started')
    xmpp = new XmppConnection(server.url)
    const connected = nextStatus(xmpp, 'connected')
    xmpp.connect('me@example.net/res', 'secret')
    return connected
  }

  it('completes the handshake and delivers the seeded roster', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({
      rosterItems: [
        {
          jid: 'peer@example.net',
          name: 'Peer',
          subscription: 'both',
          groups: ['Friends']
        },
        { jid: 'other@example.net', subscription: 'to' }
      ]
    })
    await server.ready

    const connected = connectedXmpp()
    if (!xmpp) throw new Error('xmpp not created')
    const roster = nextEvent(xmpp, 'roster')
    await connected

    expect(xmpp.connected).toBe(true)
    expect(xmpp.jid).toBe('me@example.net/res')

    await expect(roster).resolves.toEqual([
      {
        jid: 'peer@example.net',
        name: 'Peer',
        subscription: 'both',
        groups: ['Friends']
      },
      { jid: 'other@example.net', name: '', subscription: 'to', groups: [] }
    ])

    const sent = server.received().join('\n')
    expect(sent).toContain('<presence')
    expect(sent).toContain('urn:xmpp:carbons:2')
    expect(sent).toContain('jabber:iq:roster')
  })

  it('emits message for a stanza pushed by the server', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer()
    await server.ready
    await connectedXmpp()
    if (!xmpp) throw new Error('xmpp not created')

    const message = nextEvent(xmpp, 'message')
    server.send(
      `<message from='peer@example.net/x' to='me@example.net/res' type='chat' id='m1'>` +
        `<body>hi</body></message>`
    )
    await expect(message).resolves.toMatchObject({
      from: 'peer@example.net/x',
      body: 'hi',
      type: 'chat'
    })
  })

  it('emits disconnected when the server drops the socket', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer()
    await server.ready
    await connectedXmpp()
    if (!xmpp) throw new Error('xmpp not created')

    const dropped = nextStatus(xmpp, 'disconnected')
    server.close()
    await dropped
    expect(xmpp.connected).toBe(false)
    // suppress the pending reconnect timer
    xmpp.disconnect()
  })

  it('emits authfail when the server rejects sasl', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({ rejectAuth: true })
    await server.ready
    if (!server) throw new Error('server not started')
    xmpp = new XmppConnection(server.url)

    const authfail = nextStatus(xmpp, 'authfail')
    const gone = nextStatus(xmpp, 'disconnected')
    // the server closes the socket after the failure; disconnecting here
    // keeps the later 'disconnected' from scheduling a reconnect
    xmpp.events.on('status', (s) => {
      if (s === 'authfail') xmpp?.disconnect()
    })
    xmpp.connect('me@example.net/res', 'bad-password')
    await authfail
    // strophe keeps conn.connected true until the socket close is processed
    await gone
    expect(xmpp.connected).toBe(false)
  })

  it('reconnects after the server drops the socket', { timeout: 15_000 }, async () => {
    server = new FakeXmppServer()
    await server.ready
    await connectedXmpp()
    if (!xmpp) throw new Error('xmpp not created')

    const dropped = nextStatus(xmpp, 'disconnected')
    server.close()
    await dropped

    const back = nextStatus(xmpp, 'connected')
    await back
    expect(xmpp.connected).toBe(true)
  })
})
