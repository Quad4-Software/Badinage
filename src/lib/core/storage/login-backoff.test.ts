import { describe, expect, it } from 'vitest'

import { AUTHFAIL_BACKOFF_MS } from '$lib/constants'

import { clearLoginBackoff, loginBackoffRemaining, recordLoginFailure } from './login-backoff'

// unique localparts keep the shared sessionStorage of the test process
// free of cross-test interference
function jid(): string {
  return `${crypto.randomUUID()}@example.net`
}

describe('login backoff', () => {
  it('escalates the delay with each consecutive failure', () => {
    const account = jid()
    const start = 1_000_000
    for (let i = 0; i < AUTHFAIL_BACKOFF_MS.length + 2; i++) {
      const until = recordLoginFailure(account, start)
      const delay = AUTHFAIL_BACKOFF_MS[Math.min(i, AUTHFAIL_BACKOFF_MS.length - 1)] ?? 0
      expect(until).toBe(start + delay)
    }
    clearLoginBackoff(account)
  })

  it('reports the remaining wait and clears expired records', () => {
    const account = jid()
    const start = 1_000_000
    recordLoginFailure(account, start)
    expect(loginBackoffRemaining(account, start + 500)).toBe(AUTHFAIL_BACKOFF_MS[0] - 500)
    expect(loginBackoffRemaining(account, start + AUTHFAIL_BACKOFF_MS[0])).toBe(0)
    // the expired record is gone, so the next failure restarts the ladder
    expect(recordLoginFailure(account, start)).toBe(start + AUTHFAIL_BACKOFF_MS[0])
    clearLoginBackoff(account)
  })

  it('scopes counters per jid', () => {
    const first = jid()
    const second = jid()
    recordLoginFailure(first)
    recordLoginFailure(first)
    recordLoginFailure(second)
    expect(loginBackoffRemaining(second)).toBeLessThanOrEqual(AUTHFAIL_BACKOFF_MS[0])
    expect(loginBackoffRemaining(first)).toBeGreaterThan(loginBackoffRemaining(second))
    clearLoginBackoff(first)
    clearLoginBackoff(second)
  })

  it('clearLoginBackoff resets the ladder', () => {
    const account = jid()
    const start = 1_000_000
    recordLoginFailure(account, start)
    recordLoginFailure(account, start)
    clearLoginBackoff(account)
    expect(loginBackoffRemaining(account)).toBe(0)
    expect(recordLoginFailure(account, start)).toBe(start + AUTHFAIL_BACKOFF_MS[0])
    clearLoginBackoff(account)
  })
})
