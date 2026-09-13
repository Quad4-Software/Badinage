import { afterEach, describe, expect, it, vi } from 'vitest'

import { PING_TIMEOUT_MS } from '$lib/constants'

import { PingManager, pingServer } from './ping'
import type { XmppTransport } from './transport'

interface SentIq {
  stanza: string
  onResult: (stanza: Element) => void
  onError?: (stanza: Element | null) => void
}

function makeTransport(jid = 'me@example.net/res') {
  const iqs: SentIq[] = []
  const transport: XmppTransport = {
    sendIq: (stanza, onResult, onError) => {
      iqs.push({ stanza: stanza.toString(), onResult, ...(onError ? { onError } : {}) })
    },
    send: vi.fn(),
    uniqueId: (prefix) => `${prefix}-1`,
    jid
  }
  return { transport, iqs }
}

const pong = {} as Element

describe('pingServer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends an iq get with the ping payload to the server domain', () => {
    const { transport, iqs } = makeTransport()
    pingServer(transport, vi.fn())
    expect(iqs).toHaveLength(1)
    expect(iqs[0]?.stanza).toContain('type="get"')
    expect(iqs[0]?.stanza).toContain('to="example.net"')
    expect(iqs[0]?.stanza).toContain('urn:xmpp:ping')
    expect(iqs[0]?.stanza).toContain('id="ping-1"')
  })

  it('reports the round trip in milliseconds on result', () => {
    vi.useFakeTimers()
    const { transport, iqs } = makeTransport()
    const onRtt = vi.fn()
    pingServer(transport, onRtt)
    vi.advanceTimersByTime(120)
    iqs[0]?.onResult(pong)
    expect(onRtt).toHaveBeenCalledWith(120)
  })

  it('calls onTimeout when the iq errors or never answers', () => {
    vi.useFakeTimers()
    const { transport, iqs } = makeTransport()
    const onTimeout = vi.fn()
    pingServer(transport, vi.fn(), onTimeout)
    iqs[0]?.onError?.(null)
    expect(onTimeout).toHaveBeenCalledTimes(1)

    const second = makeTransport()
    pingServer(second.transport, vi.fn(), onTimeout)
    vi.advanceTimersByTime(PING_TIMEOUT_MS)
    expect(onTimeout).toHaveBeenCalledTimes(2)
  })

  it('does not double-report when a late result lands after the timeout', () => {
    vi.useFakeTimers()
    const { transport, iqs } = makeTransport()
    const onRtt = vi.fn()
    const onTimeout = vi.fn()
    pingServer(transport, onRtt, onTimeout)
    vi.advanceTimersByTime(PING_TIMEOUT_MS)
    iqs[0]?.onResult(pong)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onRtt).not.toHaveBeenCalled()
  })
})

describe('PingManager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pings only after the connection has been silent for the interval', () => {
    vi.useFakeTimers()
    const { transport, iqs } = makeTransport()
    const ping = new PingManager(transport, vi.fn(), 1_000)
    ping.start()
    vi.advanceTimersByTime(999)
    expect(iqs).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(iqs).toHaveLength(1)
    ping.stop()
  })

  it('inbound traffic resets the silence clock', () => {
    vi.useFakeTimers()
    const { transport, iqs } = makeTransport()
    const ping = new PingManager(transport, vi.fn(), 1_000)
    ping.start()
    vi.advanceTimersByTime(900)
    ping.noteInbound()
    vi.advanceTimersByTime(900)
    expect(iqs).toHaveLength(0)
    vi.advanceTimersByTime(200)
    expect(iqs).toHaveLength(1)
    ping.stop()
  })

  it('emits latency when the pong lands and pings again next tick', () => {
    vi.useFakeTimers()
    const { transport, iqs } = makeTransport()
    const onLatency = vi.fn()
    const ping = new PingManager(transport, onLatency, 1_000)
    ping.start()
    vi.advanceTimersByTime(1_000)
    vi.advanceTimersByTime(30)
    iqs[0]?.onResult(pong)
    expect(onLatency).toHaveBeenCalledWith(30)
    // no second ping while the previous one was still in flight
    vi.advanceTimersByTime(1_000)
    expect(iqs).toHaveLength(2)
    ping.stop()
  })

  it('does not stack a second ping while one is in flight', () => {
    vi.useFakeTimers()
    const { transport, iqs } = makeTransport()
    const ping = new PingManager(transport, vi.fn(), 1_000)
    ping.start()
    vi.advanceTimersByTime(1_000)
    expect(iqs).toHaveLength(1)
    vi.advanceTimersByTime(1_000)
    expect(iqs).toHaveLength(1)
    ping.stop()
  })

  it('stop ends the cadence', () => {
    vi.useFakeTimers()
    const { transport, iqs } = makeTransport()
    const ping = new PingManager(transport, vi.fn(), 1_000)
    ping.start()
    ping.stop()
    vi.advanceTimersByTime(10_000)
    expect(iqs).toHaveLength(0)
  })
})
