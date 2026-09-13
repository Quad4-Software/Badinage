// OAuth session persistence. The pending flow stash has to survive the
// authorize redirect round trip, so it lives in sessionStorage under the
// badinage namespace; tokens likewise stay in sessionStorage only per the
// secrets policy. Dynamic client registrations are app credentials, not
// secrets, so they go to localStorage and survive tab closes.

import { globalKey, scopedKey } from '$lib/core/storage/keys'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// node tests have no web storage; an in-memory map keeps the same
// semantics within the process
const memory = new Map<string, string>()
const memoryStore: Store = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key)
}

function sessionStore(): Store {
  return typeof sessionStorage === 'undefined' ? memoryStore : sessionStorage
}

function localStore(): Store {
  return typeof localStorage === 'undefined' ? memoryStore : localStorage
}

// The state the authorize redirect has to come back to. Everything needed
// to finish the code exchange and connect is here; nothing here is more
// sensitive than the pkce verifier, which the tab closing can safely burn.
export interface PendingOAuthFlow {
  jid: string
  websocketUrl?: string | undefined
  boshUrl?: string | undefined
  discoveryUrl: string
  issuer: string
  clientId: string
  state: string
  verifier: string
  redirectUri: string
  remember?: boolean | undefined
  untrusted?: boolean | undefined
}

const PENDING_KEY = globalKey('oauth', 'pending')

export function savePendingFlow(flow: PendingOAuthFlow): void {
  sessionStore().setItem(PENDING_KEY, JSON.stringify(flow))
}

export function takePendingFlow(): PendingOAuthFlow | null {
  const raw = sessionStore().getItem(PENDING_KEY)
  if (!raw) return null
  sessionStore().removeItem(PENDING_KEY)
  try {
    const flow = JSON.parse(raw) as PendingOAuthFlow
    if (!flow.jid || !flow.state || !flow.verifier || !flow.clientId) return null
    return flow
  } catch {
    return null
  }
}

export interface StoredTokens {
  accessToken: string
  refreshToken?: string | undefined
  expiresAt?: number | undefined
  // the endpoints needed to mint a fresh access token later
  discoveryUrl: string
  clientId: string
}

export function saveOAuthTokens(jid: string, tokens: StoredTokens): void {
  sessionStore().setItem(scopedKey(jid, 'oauth-token'), JSON.stringify(tokens))
}

export function loadOAuthTokens(jid: string): StoredTokens | null {
  const raw = sessionStore().getItem(scopedKey(jid, 'oauth-token'))
  if (!raw) return null
  try {
    const tokens = JSON.parse(raw) as StoredTokens
    return tokens.accessToken ? tokens : null
  } catch {
    sessionStore().removeItem(scopedKey(jid, 'oauth-token'))
    return null
  }
}

export function clearOAuthTokens(jid: string): void {
  sessionStore().removeItem(scopedKey(jid, 'oauth-token'))
}

// RFC 7591 client ids keyed by issuer; registration is idempotent and the
// id is public knowledge, so localStorage persistence is fine
export function saveOAuthClientId(issuer: string, clientId: string): void {
  localStore().setItem(globalKey('oauth', 'client', btoa(issuer)), clientId)
}

export function loadOAuthClientId(issuer: string): string | null {
  return localStore().getItem(globalKey('oauth', 'client', btoa(issuer)))
}
