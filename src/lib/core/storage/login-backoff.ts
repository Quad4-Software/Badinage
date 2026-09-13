// Per-jid login failure backoff, kept in sessionStorage. Each failed
// attempt escalates the delay before the login form re-enables (see
// AUTHFAIL_BACKOFF_MS), a successful connect resets the counter, and a
// page reload clears it, which is deliberate: the throttle only protects
// against hot retry loops inside a session, it is not a security lockout.

import { AUTHFAIL_BACKOFF_MS } from '$lib/constants'

import { scopedKey } from './keys'

interface BackoffRecord {
  count: number
  until: number
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// node tests have no sessionStorage. An in-memory map keeps the same
// semantics within the process
const memory = new Map<string, string>()
const memoryStore: Store = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key)
}

function store(): Store {
  return typeof sessionStorage === 'undefined' ? memoryStore : sessionStorage
}

function key(jid: string): string {
  return scopedKey(jid, 'login-backoff')
}

function read(jid: string): BackoffRecord | null {
  const raw = store().getItem(key(jid))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as BackoffRecord
    return typeof parsed.count === 'number' && typeof parsed.until === 'number' ? parsed : null
  } catch {
    store().removeItem(key(jid))
    return null
  }
}

// Record a failed attempt and return the timestamp the backoff ends at.
export function recordLoginFailure(jid: string, now = Date.now()): number {
  const count = (read(jid)?.count ?? 0) + 1
  // the index is clamped to the ladder length, so the fallback is unreachable
  const delay = AUTHFAIL_BACKOFF_MS[Math.min(count - 1, AUTHFAIL_BACKOFF_MS.length - 1)] ?? 0
  const until = now + delay
  store().setItem(key(jid), JSON.stringify({ count, until } satisfies BackoffRecord))
  return until
}

// Milliseconds the jid must still wait before the next attempt. 0 when
// there is nothing to wait for.
export function loginBackoffRemaining(jid: string, now = Date.now()): number {
  const record = read(jid)
  if (!record) return 0
  const left = record.until - now
  if (left <= 0) {
    store().removeItem(key(jid))
    return 0
  }
  return left
}

export function clearLoginBackoff(jid: string): void {
  store().removeItem(key(jid))
}
