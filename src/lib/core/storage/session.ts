// Session persistence in sessionStorage: remember-me logins survive a
// reload but never touch disk beyond the tab. All web storage access for
// the state layer funnels through here so state/ stays DOM-free.

import { PANE_AUTOSAVE_IDS, STORAGE_PREFIX } from '$lib/constants'
import { decryptRecord, encryptRecord, getKek, isWrappedRecord } from '$lib/core/storage/crypto'
import { scopedKey } from '$lib/core/storage/keys'

// Serializable login options as written to sessionStorage. The state
// layer's AccountOptions aliases this shape.
export interface SessionOptions {
  jid: string
  password: string
  // wire protocol. Absent means xmpp for backward compatibility with
  // sessions persisted before the field existed. irc builds an
  // IrcConnection, demo keeps using the demo flag
  protocol?: 'xmpp' | 'irc' | undefined
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
  // SASL ANONYMOUS login: jid holds just the domain and the server
  // assigns a throwaway account. Never persisted, always paired with
  // the untrusted flag
  anonymous?: boolean | undefined
}

// While the app lock is enabled session blobs are stored as KEK-sealed
// envelopes so a locked profile holds no plaintext password at rest.
export async function saveSession(options: SessionOptions): Promise<void> {
  if (!(options.remember && !options.demo && !options.untrusted && !options.anonymous)) return
  const kek = getKek()
  const payload = kek ? await encryptRecord(kek, options) : options
  sessionStorage.setItem(scopedKey(options.jid, 'session'), JSON.stringify(payload))
}

export async function restoreSessions(): Promise<SessionOptions[]> {
  const kek = getKek()
  const restored: SessionOptions[] = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i)
    if (!key?.endsWith(':session')) continue
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) ?? '') as unknown
      if (isWrappedRecord(parsed)) {
        // a sealed blob while locked cannot be opened - leave it for
        // the unlock path rather than dropping a valid session
        if (!kek) continue
        restored.push(await decryptRecord<SessionOptions>(kek, parsed))
      } else {
        restored.push(parsed as SessionOptions)
      }
    } catch {
      sessionStorage.removeItem(key)
    }
  }
  return restored
}

// Seal or unseal every persisted session in place. Called when the app
// lock is enabled or disabled so sessionStorage matches the lock mode.
export async function rewrapSessions(seal: boolean): Promise<void> {
  const kek = getKek()
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i)
    if (!key?.endsWith(':session')) continue
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) ?? '') as unknown
      if (seal && kek && !isWrappedRecord(parsed)) {
        sessionStorage.setItem(key, JSON.stringify(await encryptRecord(kek, parsed)))
      } else if (!seal && isWrappedRecord(parsed) && kek) {
        const plain = await decryptRecord<SessionOptions>(kek, parsed)
        sessionStorage.setItem(key, JSON.stringify(plain))
      }
    } catch {
      sessionStorage.removeItem(key)
    }
  }
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
