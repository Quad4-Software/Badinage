import { describe, expect, it } from 'vitest'

import type { SMState } from 'strophe.js'

import { ScopedSmStorage, smConnectionOptions } from './sm'

function state(id: string): SMState {
  // only the fields this test round-trips matter; the backend treats the
  // payload as opaque json
  return { id, hIn: 3, enabled: true } as SMState
}

describe('ScopedSmStorage', () => {
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
