// Session persistence in sessionStorage: remember-me logins survive a
// reload but never touch disk beyond the tab. All web storage access for
// the state layer funnels through here so state/ stays DOM-free.

import { STORAGE_PREFIX } from '$lib/constants'
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
}

export function saveSession(options: SessionOptions): void {
  if (options.remember && !options.demo) {
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

// Drop every badinage-namespaced key from both storage areas. Used by
// the wipe-all-data flow; collects keys first so removals do not disturb
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
}
