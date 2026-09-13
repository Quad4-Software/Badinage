import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  loadOAuthClientId,
  loadOAuthTokens,
  saveOAuthClientId,
  saveOAuthTokens,
  savePendingFlow,
  takePendingFlow
} from './session'
import type { PendingOAuthFlow } from './session'

function memoryStore() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    clear: () => map.clear()
  } as Storage
}

const FLOW: PendingOAuthFlow = {
  jid: 'me@example.net',
  websocketUrl: 'wss://example.net/ws',
  discoveryUrl: 'https://id.example.net/.well-known/oc',
  issuer: 'https://id.example.net',
  clientId: 'c1',
  state: 'st',
  verifier: 'v',
  redirectUri: 'https://app.example.net/'
}

describe('oauth session store', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStore())
    vi.stubGlobal('localStorage', memoryStore())
  })

  it('takes the pending flow once', () => {
    savePendingFlow(FLOW)
    expect(takePendingFlow()).toEqual(FLOW)
    // a spent flow cannot be replayed
    expect(takePendingFlow()).toBeNull()
  })

  it('drops a malformed pending flow', () => {
    sessionStorage.setItem('badinage:oauth:pending', '{not json')
    expect(takePendingFlow()).toBeNull()
    sessionStorage.setItem('badinage:oauth:pending', '{"jid":""}')
    expect(takePendingFlow()).toBeNull()
  })

  it('round-trips tokens under the account-scoped key', () => {
    saveOAuthTokens('me@example.net/res', {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1,
      discoveryUrl: 'https://id.example.net/.well-known/oc',
      clientId: 'c1'
    })
    expect(loadOAuthTokens('me@example.net')?.accessToken).toBe('at')
    expect(loadOAuthTokens('other@example.net')).toBeNull()
  })

  it('persists client ids per issuer across storage areas', () => {
    saveOAuthClientId('https://id.example.net', 'c1')
    expect(loadOAuthClientId('https://id.example.net')).toBe('c1')
    expect(loadOAuthClientId('https://other.example.net')).toBeNull()
  })
})
