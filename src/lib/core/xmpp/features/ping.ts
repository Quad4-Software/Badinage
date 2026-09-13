// XEP-0199 ping keepalive and latency measurement. A bare iq get with a
// ping element to the server domain; the result or error ends the round
// trip. PingManager owns the cadence: it pings only after PING_INTERVAL_MS
// of inbound silence, since pings during active traffic are wasteful, and
// it never runs while disconnected.

import { $iq } from 'strophe.js'

import { PING_INTERVAL_MS, PING_TIMEOUT_MS } from '$lib/constants'
import { jidDomain } from '$lib/utils/jid'

import { NS } from '../ns'
import type { XmppTransport } from './transport'

// One ping round trip to the server domain. onRtt gets milliseconds,
// onTimeout fires when nothing came back within PING_TIMEOUT_MS.
export function pingServer(
  conn: XmppTransport,
  onRtt: (ms: number) => void,
  onTimeout?: () => void
): void {
  const started = Date.now()
  // latched so a late iq response after the timeout cannot report twice
  let settled = false
  const timer = setTimeout(() => {
    settled = true
    onTimeout?.()
  }, PING_TIMEOUT_MS)
  const done = (rtt?: number) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (rtt === undefined) onTimeout?.()
    else onRtt(rtt)
  }
  conn.sendIq(
    $iq({ type: 'get', to: jidDomain(conn.jid), id: conn.uniqueId('ping') }).c('ping', {
      xmlns: NS.PING
    }),
    () => done(Date.now() - started),
    () => done()
  )
}

// Periodic keepalive driven off inbound silence. The connection calls
// noteInbound from its stanza-in hook and start/stop around the
// connected session; timers never outlive the connection that owns them.
export class PingManager {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastInbound = 0
  private inflight = false

  constructor(
    private readonly conn: XmppTransport,
    private readonly onLatency: (ms: number) => void,
    private readonly interval = PING_INTERVAL_MS
  ) {}

  noteInbound(): void {
    this.lastInbound = Date.now()
  }

  start(): void {
    this.stop()
    this.lastInbound = Date.now()
    this.inflight = false
    this.timer = setInterval(() => this.tick(), this.interval)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.inflight = false
  }

  private tick(): void {
    if (this.inflight) return
    if (Date.now() - this.lastInbound < this.interval) return
    this.inflight = true
    pingServer(
      this.conn,
      (ms) => {
        this.inflight = false
        this.onLatency(ms)
      },
      () => {
        // an unanswered ping is ignored: the transport notices a dead
        // socket on its own and the next tick retries anyway
        this.inflight = false
      }
    )
  }
}
