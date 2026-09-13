// Live XEP-0198/0199 coverage against the scripted fake server: stream
// management enable, ack round-trips, drop plus resume, the resume-failed
// fallback to bind, unacked resend, and a ping pong over the real socket.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FakeXmppServer } from '../../../../test/fake-xmpp-server'

import { XmppConnection } from './connection'
import { pingServer } from './features/ping'
import type { XmppTransport } from './features/transport'
import type { ConnectionStatus } from './types'

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

async function waitFor(cond: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('stream resilience over a live fake xmpp server', () => {
  let server: FakeXmppServer | undefined
  let xmpp: XmppConnection | undefined

  afterEach(async () => {
    xmpp?.disconnect()
    await server?.stop()
    xmpp = undefined
    server = undefined
  })

  // unique localparts keep the process-shared sm storage from leaking a
  // resumable session into an unrelated test
  async function connectedSm(local: string): Promise<void> {
    if (!server) throw new Error('server not started')
    xmpp = new XmppConnection(server.url)
    const connected = nextStatus(xmpp, 'connected')
    xmpp.connect(`${local}@example.net/res`, 'secret')
    await connected
  }

  it(
    'negotiates stream management when the server advertises it',
    { timeout: 10_000 },
    async () => {
      server = new FakeXmppServer({ sm: {} })
      await server.ready
      await connectedSm('sm-enable')
      if (!xmpp) throw new Error('xmpp not created')

      await waitFor(() => xmpp?.streamManagementEnabled() === true)
      const sent = server.received()
      const enable = sent.find((f) => f.startsWith('<enable'))
      expect(enable).toContain('urn:xmpp:sm:3')
      expect(enable).toContain('resume="true"')
      expect(xmpp.sessionResumed()).toBe(false)
    }
  )

  it('answers a server ack request with its inbound count', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({ sm: {} })
    await server.ready
    await connectedSm('sm-ack')
    await waitFor(() => xmpp?.streamManagementEnabled() === true)
    if (!server) throw new Error('server gone')

    server.send("<r xmlns='urn:xmpp:sm:3'/>")
    await waitFor(() => server !== undefined && server.received().some((f) => /^<a[\s/>]/.test(f)))
    const ack = server.received().find((f) => /^<a[\s/>]/.test(f))
    expect(ack).toContain('urn:xmpp:sm:3')
    expect(ack).toMatch(/\bh=["']\d/)
  })

  it('asks the server for an ack after enough unacked sends', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({ sm: {} })
    await server.ready
    await connectedSm('sm-r')
    await waitFor(() => xmpp?.streamManagementEnabled() === true)
    if (!xmpp || !server) throw new Error('gone')

    for (let i = 0; i < 6; i++) xmpp.sendChatMessage('peer@example.net', `m${i}`)
    await waitFor(() => server?.received().some((f) => /^<r[\s>]/.test(f)) === true)
  })

  it('resumes the session after a socket drop', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({ sm: {} })
    await server.ready
    await connectedSm('sm-resume')
    await waitFor(() => xmpp?.streamManagementEnabled() === true)
    if (!xmpp || !server) throw new Error('gone')

    const dropped = nextStatus(xmpp, 'disconnected')
    server.close()
    await dropped

    // reconnect at once instead of waiting out the backoff timer
    const back = nextStatus(xmpp, 'connected')
    xmpp.connect('sm-resume@example.net/res', 'secret')
    await back

    expect(server.received().some((f) => f.startsWith('<resume'))).toBe(true)
    expect(xmpp.sessionResumed()).toBe(true)
    expect(xmpp.streamManagementEnabled()).toBe(true)
    // a resumed session keeps the bound jid and skips resource binding
    expect(xmpp.jid).toBe('sm-resume@example.net/res')
    expect(
      server.received().filter((f) => f.includes('urn:ietf:params:xml:ns:xmpp-bind'))
    ).toHaveLength(1)
  })

  it(
    'falls back to a fresh bind when the server refuses resumption',
    { timeout: 10_000 },
    async () => {
      server = new FakeXmppServer({ sm: {} })
      await server.ready
      await connectedSm('sm-fail')
      await waitFor(() => xmpp?.streamManagementEnabled() === true)
      if (!xmpp || !server) throw new Error('gone')

      const dropped = nextStatus(xmpp, 'disconnected')
      server.close()
      await dropped

      // the same server now rejects resumes, as if the session expired
      server.expireSmSession()
      const back = nextStatus(xmpp, 'connected')
      xmpp.connect('sm-fail@example.net/res', 'secret')
      await back

      expect(server.received().some((f) => f.startsWith('<resume'))).toBe(true)
      expect(xmpp.sessionResumed()).toBe(false)
      // fallback bound a second time: two bind iqs in the whole frame log
      expect(
        server.received().filter((f) => f.includes('urn:ietf:params:xml:ns:xmpp-bind'))
      ).toHaveLength(2)
    }
  )

  it('resends stanzas the server did not ack before the drop', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({ sm: { unackedOnResume: 1 } })
    await server.ready
    await connectedSm('sm-resend')
    await waitFor(() => xmpp?.streamManagementEnabled() === true)
    if (!xmpp || !server) throw new Error('gone')

    xmpp.sendChatMessage('peer@example.net', 'resend-me')
    await waitFor(() => server?.received().some((f) => f.includes('resend-me')) === true)

    const dropped = nextStatus(xmpp, 'disconnected')
    server.close()
    await dropped

    const back = nextStatus(xmpp, 'connected')
    xmpp.connect('sm-resend@example.net/res', 'secret')
    await back

    await waitFor(() => server?.received().filter((f) => f.includes('resend-me')).length === 2)
  })

  it('measures a ping round trip against the server', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer()
    await server.ready
    if (!server) throw new Error('server not started')
    xmpp = new XmppConnection(server.url)
    const connected = nextStatus(xmpp, 'connected')
    xmpp.connect('pinger@example.net/res', 'secret')
    await connected
    const conn = xmpp

    const transport: XmppTransport = {
      sendIq: (stanza, onResult, onError) => conn.sendIq(stanza, onResult, onError),
      send: vi.fn(),
      uniqueId: (prefix) => conn.uniqueId(prefix),
      get jid() {
        return conn.jid
      }
    }
    const rtt = await new Promise<number>((resolve, reject) => {
      pingServer(transport, resolve, () => reject(new Error('ping timed out')))
    })
    expect(rtt).toBeGreaterThanOrEqual(0)
    expect(server.received().some((f) => f.includes('urn:xmpp:ping'))).toBe(true)
  })
})
