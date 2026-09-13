import { Strophe } from 'strophe.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS } from '$lib/constants'

import { findHandler, makeStub, xml } from '../../../../test/stub-connection'
import type { ConnectionStatus } from './types'

describe('XmppConnection with a stubbed strophe connection', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps strophe statuses onto the public connection status', () => {
    const { conn, xmpp, drive } = makeStub()
    const seen: ConnectionStatus[] = []
    xmpp.events.on('status', (s) => seen.push(s))

    xmpp.connect('me@example.net/res', 'secret')
    drive(Strophe.Status.CONNECTING)
    drive(Strophe.Status.AUTHENTICATING)
    drive(Strophe.Status.CONNECTED)
    drive(Strophe.Status.DISCONNECTING)
    // empty pass keeps DISCONNECTED from scheduling a reconnect timer
    conn.pass = ''
    drive(Strophe.Status.DISCONNECTED)

    expect(seen).toEqual(['connecting', 'connecting', 'connected', 'disconnecting', 'disconnected'])
  })

  it('maps auth and transport failures to authfail and error', () => {
    const { xmpp, drive } = makeStub()
    const seen: ConnectionStatus[] = []
    xmpp.events.on('status', (s) => seen.push(s))

    xmpp.connect('me@example.net/res', 'secret')
    drive(Strophe.Status.AUTHFAIL)
    drive(Strophe.Status.ERROR)
    drive(Strophe.Status.CONNTIMEOUT)
    drive(Strophe.Status.CONNFAIL)

    expect(seen).toEqual(['authfail', 'error', 'error', 'error'])
  })

  it('registers stanza handlers and sends carbons, presence and roster get', () => {
    const { xmpp, drive, addHandler, send, sendIQ } = makeStub()
    xmpp.connect('me@example.net/res', 'secret')
    drive(Strophe.Status.CONNECTED)

    expect(addHandler).toHaveBeenCalledTimes(5)
    const registrations = addHandler.mock.calls.map((c) => ({
      ns: c[1],
      name: c[2],
      type: c[3]
    }))
    expect(registrations).toEqual([
      { ns: null, name: 'message', type: null },
      { ns: null, name: 'presence', type: null },
      { ns: 'jabber:iq:roster', name: 'iq', type: 'set' },
      { ns: 'urn:xmpp:blocking', name: 'iq', type: 'set' },
      { ns: 'urn:xmpp:ping', name: 'iq', type: 'get' }
    ])

    const iqs = sendIQ.mock.calls.map((c) => c[0].toString())
    expect(iqs).toHaveLength(2)
    expect(iqs[0]).toContain('urn:xmpp:carbons:2')
    expect(iqs[0]).toContain('<enable')
    expect(iqs[1]).toContain('jabber:iq:roster')
    expect(iqs[1]).toContain('type="get"')

    const sent = send.mock.calls.map((c) => String(c[0]))
    expect(sent.some((s) => s.startsWith('<presence'))).toBe(true)
  })

  it('emits message for an incoming chat stanza', () => {
    const stub = makeStub()
    const onMessage = vi.fn()
    stub.xmpp.events.on('message', onMessage)
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'message')
    const keep = handler(
      xml(`<message from='peer@example.net/x' to='me@example.net/res' type='chat' id='m1'>
        <body>hi there</body>
      </message>`)
    )
    expect(keep).toBe(true)
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'peer@example.net/x', body: 'hi there', type: 'chat' })
    )
  })

  it('emits rosterUpdate and replies result on a roster push', () => {
    const stub = makeStub()
    const onUpdate = vi.fn()
    stub.xmpp.events.on('rosterUpdate', onUpdate)
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'iq', 'jabber:iq:roster')
    stub.send.mockClear()
    handler(
      xml(`<iq type='set' id='rp1' from='me@example.net'>
        <query xmlns='jabber:iq:roster'>
          <item jid='peer@example.net' name='Peer' subscription='both'/>
        </query>
      </iq>`)
    )

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ jid: 'peer@example.net', name: 'Peer', subscription: 'both' })
    )
    const replies = stub.send.mock.calls.map((c) => String(c[0]))
    expect(replies).toHaveLength(1)
    expect(replies[0]).toContain('type="result"')
    expect(replies[0]).toContain('id="rp1"')
    expect(replies[0]).toContain('to="me@example.net"')
  })

  it('emits blocked on a blocklist push and replies result', () => {
    const stub = makeStub()
    const onBlocked = vi.fn()
    stub.xmpp.events.on('blocked', onBlocked)
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'iq', 'urn:xmpp:blocking')
    stub.send.mockClear()
    handler(
      xml(`<iq type='set' id='b1'>
        <block xmlns='urn:xmpp:blocking'><item jid='spam@example.net'/></block>
      </iq>`)
    )

    expect(onBlocked).toHaveBeenCalledWith(['spam@example.net'])
    const replies = stub.send.mock.calls.map((c) => String(c[0]))
    expect(replies).toHaveLength(1)
    expect(replies[0]).toContain('type="result"')
    expect(replies[0]).toContain('id="b1"')
  })

  it('emits presence and subscriptionRequest for presence stanzas', () => {
    const stub = makeStub()
    const onPresence = vi.fn()
    const onSub = vi.fn()
    stub.xmpp.events.on('presence', onPresence)
    stub.xmpp.events.on('subscriptionRequest', onSub)
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'presence')
    handler(
      xml(`<presence from='peer@example.net/x'><show>away</show><status>lunch</status></presence>`)
    )
    expect(onPresence).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'peer@example.net', show: 'away', status: 'lunch' })
    )

    handler(xml(`<presence from='new@example.net' type='subscribe'><status>hi</status></presence>`))
    expect(onSub).toHaveBeenCalledWith({ from: 'new@example.net', status: 'hi' })
  })

  it('accepts the instant room when self presence carries status 201', () => {
    const stub = makeStub()
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'presence')
    stub.sendIQ.mockClear()
    handler(
      xml(`<presence from='room@conference.example.net/me'>
        <x xmlns='http://jabber.org/protocol/muc#user'>
          <item affiliation='owner' role='moderator'/>
          <status code='110'/><status code='201'/>
        </x>
      </presence>`)
    )
    const iqs = stub.sendIQ.mock.calls.map((c) => c[0].toString())
    expect(iqs).toHaveLength(1)
    expect(iqs[0]).toContain('type="set"')
    expect(iqs[0]).toContain('to="room@conference.example.net"')
    expect(iqs[0]).toContain('http://jabber.org/protocol/muc#owner')
    expect(iqs[0]).toContain('jabber:x:data')
  })

  it('ignores a 201 code on presence that is not our own', () => {
    const stub = makeStub()
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'presence')
    stub.sendIQ.mockClear()
    handler(
      xml(`<presence from='room@conference.example.net/other'>
        <x xmlns='http://jabber.org/protocol/muc#user'>
          <item affiliation='member' role='participant'/>
          <status code='201'/>
        </x>
      </presence>`)
    )
    expect(stub.sendIQ).not.toHaveBeenCalled()
  })

  describe('reconnect backoff', () => {
    it('reconnects after RECONNECT_DELAY_MS', () => {
      vi.useFakeTimers()
      const { xmpp, connect, drive } = makeStub()
      xmpp.connect('me@example.net/res', 'secret')
      expect(connect).toHaveBeenCalledTimes(1)

      drive(Strophe.Status.DISCONNECTED)
      vi.advanceTimersByTime(RECONNECT_DELAY_MS - 1)
      expect(connect).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1)
      expect(connect).toHaveBeenCalledTimes(2)
    })

    it('doubles the delay on each failure up to RECONNECT_DELAY_MAX_MS', () => {
      vi.useFakeTimers()
      const { xmpp, connect, drive } = makeStub()
      xmpp.connect('me@example.net/res', 'secret')

      const delays = [
        RECONNECT_DELAY_MS,
        10_000,
        20_000,
        40_000,
        RECONNECT_DELAY_MAX_MS,
        RECONNECT_DELAY_MAX_MS
      ]
      let expectedCalls = 1
      for (const delay of delays) {
        drive(Strophe.Status.DISCONNECTED)
        vi.advanceTimersByTime(delay - 1)
        expect(connect).toHaveBeenCalledTimes(expectedCalls)
        vi.advanceTimersByTime(1)
        expectedCalls += 1
        expect(connect).toHaveBeenCalledTimes(expectedCalls)
      }
    })

    it('resets the delay after a successful connect', () => {
      vi.useFakeTimers()
      const { xmpp, connect, drive } = makeStub()
      xmpp.connect('me@example.net/res', 'secret')

      drive(Strophe.Status.DISCONNECTED)
      vi.advanceTimersByTime(RECONNECT_DELAY_MS)
      expect(connect).toHaveBeenCalledTimes(2)

      drive(Strophe.Status.CONNECTED)
      drive(Strophe.Status.DISCONNECTED)
      vi.advanceTimersByTime(RECONNECT_DELAY_MS - 1)
      expect(connect).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(1)
      expect(connect).toHaveBeenCalledTimes(3)
    })

    it('does not reconnect after a manual disconnect', () => {
      vi.useFakeTimers()
      const { xmpp, connect, disconnect, drive } = makeStub()
      xmpp.connect('me@example.net/res', 'secret')
      xmpp.disconnect()
      expect(disconnect).toHaveBeenCalledTimes(1)

      drive(Strophe.Status.DISCONNECTED)
      vi.advanceTimersByTime(RECONNECT_DELAY_MAX_MS * 4)
      expect(connect).toHaveBeenCalledTimes(1)
    })

    it('does not reconnect without a stored password', () => {
      vi.useFakeTimers()
      const { conn, xmpp, connect, drive } = makeStub()
      xmpp.connect('me@example.net/res', '')
      drive(Strophe.Status.DISCONNECTED)
      vi.advanceTimersByTime(RECONNECT_DELAY_MAX_MS * 4)
      expect(connect).toHaveBeenCalledTimes(1)

      // a missing pass hits the same guard through typeof
      conn.pass = 'secret'
      Reflect.deleteProperty(conn, 'pass')
      drive(Strophe.Status.DISCONNECTED)
      vi.advanceTimersByTime(RECONNECT_DELAY_MAX_MS * 4)
      expect(connect).toHaveBeenCalledTimes(1)
    })
  })
})
