import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearScopedStorage, clearSession, restoreSessions, saveSession } from './session'

// node has no web storage, so the globals get a minimal Map-backed stand-in
// implementing just the Storage surface session.ts uses
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    }
  }
}

let session: Storage
let local: Storage

beforeEach(() => {
  session = fakeStorage()
  local = fakeStorage()
  vi.stubGlobal('sessionStorage', session)
  vi.stubGlobal('localStorage', local)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saveSession', () => {
  it('persists options under the scoped session key when remember is set', () => {
    saveSession({ jid: 'romeo@example.net/web', password: 'secret', remember: true })
    const raw = session.getItem('badinage:romeo@example.net:session')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? '')).toMatchObject({
      jid: 'romeo@example.net/web',
      password: 'secret'
    })
  })

  it('writes nothing without remember or for demo sessions', () => {
    saveSession({ jid: 'a@x.org', password: 'p' })
    saveSession({ jid: 'b@x.org', password: 'p', remember: true, demo: true })
    expect(session.length).toBe(0)
  })

  it('writes nothing for untrusted logins even when remember is set', () => {
    saveSession({ jid: 'c@x.org', password: 'p', remember: true, untrusted: true })
    expect(session.length).toBe(0)
    expect(restoreSessions()).toEqual([])
  })
})

describe('restoreSessions', () => {
  it('returns saved sessions and ignores unrelated keys', () => {
    session.setItem(
      'badinage:romeo@example.net:session',
      JSON.stringify({ jid: 'romeo@example.net', password: 'p' })
    )
    session.setItem('badinage:romeo@example.net:other', 'noise')
    session.setItem('unrelated:thing', 'noise')

    const restored = restoreSessions()
    expect(restored).toEqual([{ jid: 'romeo@example.net', password: 'p' }])
  })

  it('drops malformed entries instead of failing the whole restore', () => {
    session.setItem('badinage:a@x.org:session', JSON.stringify({ jid: 'a@x.org', password: 'p' }))
    session.setItem('badinage:b@x.org:session', 'not json{')

    expect(restoreSessions()).toEqual([{ jid: 'a@x.org', password: 'p' }])
    expect(session.getItem('badinage:b@x.org:session')).toBeNull()
  })
})

describe('clearSession', () => {
  it('removes only the given account session', () => {
    session.setItem('badinage:a@x.org:session', '{}')
    session.setItem('badinage:b@x.org:session', '{}')
    clearSession('a@x.org')
    expect(session.getItem('badinage:a@x.org:session')).toBeNull()
    expect(session.getItem('badinage:b@x.org:session')).toBe('{}')
  })
})

describe('clearScopedStorage', () => {
  it('wipes every badinage key from both storage areas', () => {
    session.setItem('badinage:a@x.org:session', '{}')
    session.setItem('unrelated', 'keep')
    local.setItem('badinage:a@x.org:kv:setting', '1')
    local.setItem('other-app:key', 'keep')

    clearScopedStorage()

    expect(session.getItem('badinage:a@x.org:session')).toBeNull()
    expect(local.getItem('badinage:a@x.org:kv:setting')).toBeNull()
    expect(session.getItem('unrelated')).toBe('keep')
    expect(local.getItem('other-app:key')).toBe('keep')
  })

  it('removes our paneforge layout keys but not other apps', () => {
    local.setItem('paneforge:badinage-shell', '{}')
    local.setItem('paneforge:badinage-split', '{}')
    local.setItem('paneforge:other-app', 'keep')

    clearScopedStorage()

    expect(local.getItem('paneforge:badinage-shell')).toBeNull()
    expect(local.getItem('paneforge:badinage-split')).toBeNull()
    expect(local.getItem('paneforge:other-app')).toBe('keep')
  })
})
