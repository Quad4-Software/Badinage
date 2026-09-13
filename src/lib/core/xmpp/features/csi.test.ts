import { Strophe } from 'strophe.js'
import { describe, expect, it, vi } from 'vitest'

import { makeStub } from '../../../../../test/stub-connection'

import { sendClientState } from './csi'
import type { XmppTransport } from './transport'

function makeTransport() {
  const send = vi.fn<XmppTransport['send']>()
  const transport: XmppTransport = {
    sendIq: vi.fn(),
    send,
    uniqueId: (prefix) => `${prefix}-1`,
    jid: 'me@example.net/res'
  }
  return { transport, send }
}

describe('sendClientState', () => {
  it('sends active and inactive nonzas in the csi namespace', () => {
    const { transport, send } = makeTransport()
    sendClientState(transport, true)
    sendClientState(transport, false)
    const sent = send.mock.calls.map((c) => c[0].toString())
    expect(sent[0]).toContain('<active')
    expect(sent[0]).toContain('urn:xmpp:csi:0')
    expect(sent[1]).toContain('<inactive')
    expect(sent[1]).toContain('urn:xmpp:csi:0')
  })
})

describe('XmppConnection client state indication', () => {
  it('sends nothing while disconnected and dedupes repeats', () => {
    const { conn, xmpp, send, drive } = makeStub()
    xmpp.connect('me@example.net/res', 'secret')

    xmpp.setClientActive(false)
    expect(send).not.toHaveBeenCalled()

    // strophe sets conn.connected before emitting CONNECTED
    conn.connected = true
    drive(Strophe.Status.CONNECTED)
    send.mockClear()

    xmpp.setClientActive(true)
    xmpp.setClientActive(true)
    const sent = send.mock.calls.map((c) => String(c[0]))
    expect(sent.filter((s) => s.includes('urn:xmpp:csi:0'))).toHaveLength(1)
    expect(sent[0]).toContain('<active')
  })

  it('replays inactive after a reconnect when the tab was left hidden', () => {
    const { conn, xmpp, send, drive } = makeStub()
    xmpp.connect('me@example.net/res', 'secret')
    xmpp.setClientActive(false)

    conn.connected = true
    drive(Strophe.Status.CONNECTED)

    const sent = send.mock.calls.map((c) => String(c[0]))
    expect(sent.some((s) => s.includes('<inactive') && s.includes('urn:xmpp:csi:0'))).toBe(true)
  })

  it('does not resend active after a reconnect since it is the default', () => {
    const { conn, xmpp, send, drive } = makeStub()
    xmpp.connect('me@example.net/res', 'secret')

    conn.connected = true
    drive(Strophe.Status.CONNECTED)
    xmpp.setClientActive(true)
    send.mockClear()

    drive(Strophe.Status.CONNECTED)
    const sent = send.mock.calls.map((c) => String(c[0]))
    expect(sent.some((s) => s.includes('urn:xmpp:csi:0'))).toBe(false)
  })
})
