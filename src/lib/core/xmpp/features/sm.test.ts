import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SMState } from 'strophe.js'

import { ScopedSmStorage, smConnectionOptions } from './sm'

// the suite runs in the node environment, which has no web storage, so
// sessionStorage gets an in-memory stand-in that keeps the scoped-key
// assertions honest
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value))
  }
}

function state(id: string): SMState {
  // only the fields this test round-trips matter. The backend treats the
  // payload as opaque json
  return { id, hIn: 3, enabled: true } as SMState
}

describe('ScopedSmStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', fakeStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips state under the per-account scoped key', () => {
    const backend = new ScopedSmStorage()
    backend.save('strophe-sm:me@example.net', state('sm-1'))

    expect(sessionStorage.getItem('badinage:me@example.net:sm')).toContain('"id":"sm-1"')
    expect(backend.load('strophe-sm:me@example.net')?.id).toBe('sm-1')

    backend.clear('strophe-sm:me@example.net')
    expect(sessionStorage.getItem('badinage:me@example.net:sm')).toBeNull()
  })

  it('keeps two accounts apart', () => {
    const backend = new ScopedSmStorage()
    backend.save('strophe-sm:one@example.net', state('a'))
    backend.save('strophe-sm:two@example.net', state('b'))
    expect(backend.load('strophe-sm:one@example.net')?.id).toBe('a')
    expect(backend.load('strophe-sm:two@example.net')?.id).toBe('b')
    backend.clear('strophe-sm:one@example.net')
    backend.clear('strophe-sm:two@example.net')
  })

  it('returns null and drops corrupt entries', () => {
    const backend = new ScopedSmStorage()
    sessionStorage.setItem('badinage:bad@example.net:sm', '{oops')
    expect(backend.load('strophe-sm:bad@example.net')).toBeNull()
    expect(sessionStorage.getItem('badinage:bad@example.net:sm')).toBeNull()
  })
})

describe('smConnectionOptions', () => {
  it('enables stream management with a scoped storage backend', () => {
    const options = smConnectionOptions()
    expect(options.enableStreamManagement).toBe(true)
    expect(options.streamManagement?.storage).toBeInstanceOf(ScopedSmStorage)
  })
})
