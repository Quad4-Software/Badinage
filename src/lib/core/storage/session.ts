// Session persistence in sessionStorage: remember-me logins survive a
// reload but never touch disk beyond the tab. All web storage access for
// the state layer funnels through here so state/ stays DOM-free.

import { PANE_AUTOSAVE_IDS, STORAGE_PREFIX } from '$lib/constants'
import { scopedKey } from '$lib/core/storage/keys'

// Serializable login options as written to sessionStorage. The state
// layer's AccountOptions aliases this shape.
export interface SessionOptions {
  jid: string
  password: string
  websocketUrl?: string | undefined
  boshUrl?: string | undefined
  remember?: boolean | undefined
  demo?: boolean | undefined
  // per-login opt-out of all local persistence: no session blob, no
  // IndexedDB writes, OMEMO keys in memory only. The flag wins over
  // remember so a shared device never keeps a session behind.
  untrusted?: boolean | undefined
  // the password slot carries an oauth access token and sasl is pinned to
  // OAUTHBEARER. Set by the XEP-0493 flow
  oauth?: boolean | undefined
}

export function saveSession(options: SessionOptions): void {
  if (options.remember && !options.demo && !options.untrusted) {
    sessionStorage.setItem(scopedKey(options.jid, 'session'), JSON.stringify(options))
  }
}

export function restoreSessions(): SessionOptions[] {
  const restored: SessionOptions[] = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i)
    if (!key?.endsWith(':session')) continue
    try {
      restored.push(JSON.parse(sessionStorage.getItem(key) ?? '') as SessionOptions)
    } catch {
      sessionStorage.removeItem(key)
    }
  }
  return restored
}

export function clearSession(jid: string): void {
  sessionStorage.removeItem(scopedKey(jid, 'session'))
}

// true when a namespaced key already holds a persisted value. Used to
// tell a returning install from a first run before any writes happen
export function hasPersisted(key: string): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null
}

// Drop every badinage-namespaced key from both storage areas. Used by
// the wipe-all-data flow. Collects keys first so removals do not disturb
// the index-based iteration.
export function clearScopedStorage(): void {
  for (const storage of [sessionStorage, localStorage]) {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(`${STORAGE_PREFIX}:`)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  }
  // pane layouts sit under paneforge's own prefix, outside our namespace
  for (const id of PANE_AUTOSAVE_IDS) localStorage.removeItem(`paneforge:${id}`)
}
