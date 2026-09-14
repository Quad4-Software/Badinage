import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  decryptRecord,
  encryptRecord,
  getKek,
  isWrappedKeyRecord,
  isWrappedRecord,
  loadWrapKey,
  setKek,
  type LockConfig
} from '../crypto'
import { changePassphrase, disableLock, enableLock, lockConfig, unlockLock } from './index'
import { restoreSessions, saveSession } from '../session'

// Map-backed stand-ins for IndexedDB and web storage, same shape as
// crypto.test.ts and session.test.ts use
const fake = vi.hoisted(() => {
  const data = new Map<string, Map<string, unknown>>()
  const store = (name: string): Map<string, unknown> => {
    let s = data.get(name)
    if (!s) {
      s = new Map()
      data.set(name, s)
    }
    return s
  }
  return {
    data,
    idb: {
      get: (s: string, k: string) => Promise.resolve(store(s).get(k)),
      set: (s: string, k: string, v: unknown) => {
        store(s).set(k, v)
        return Promise.resolve()
      },
      del: (s: string, k: string) => {
        store(s).delete(k)
        return Promise.resolve()
      },
      keys: (s: string) => Promise.resolve([...store(s).keys()]),
      clear: (s: string) => {
        store(s).clear()
        return Promise.resolve()
      }
    }
  }
})

vi.mock('$lib/core/storage/idb', () => ({ idb: fake.idb }))

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

const JID = 'romeo@example.net'
const OM_KEY = `badinage:${JID}:omemo-wrap`
const MSGS_KEY = `badinage:${JID}:msgs-wrap`

// seed a legacy (pre-lock) profile: a plaintext wrap key in kv plus a
// record it protects in each table
async function seedLegacy(): Promise<{ omKey: CryptoKey; msgsKey: CryptoKey }> {
  const subtle = crypto.subtle
  const omKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
  const msgsKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
  await fake.idb.set('kv', OM_KEY, omKey)
  await fake.idb.set('kv', MSGS_KEY, msgsKey)
  await fake.idb.set('omemo', `badinage:${JID}:om:ident`, await encryptRecord(omKey, { pk: 1 }))
  await fake.idb.set(
    'messages',
    `badinage:${JID}:msgs:juliet@example.net`,
    await encryptRecord(msgsKey, [{ id: 'm1', body: 'hi' }])
  )
  return { omKey, msgsKey }
}

beforeEach(() => {
  fake.data.clear()
  setKek(undefined)
  vi.stubGlobal('sessionStorage', fakeStorage())
})

describe('enableLock + unlockLock', () => {
  it('writes a config whose canary only the passphrase opens', async () => {
    await enableLock('correct horse')
    const config = (await lockConfig()) as LockConfig
    expect(config.salt).toBeTruthy()
    expect(config.iter).toBeGreaterThan(0)
    expect(isWrappedRecord(config.canary)).toBe(true)
    expect(getKek()).toBeDefined()
  })

  it('rejects a wrong passphrase and accepts the right one', async () => {
    await enableLock('correct horse')
    setKek(undefined)
    await expect(unlockLock('wrong')).resolves.toBe(false)
    expect(getKek()).toBeUndefined()
    await expect(unlockLock('correct horse')).resolves.toBe(true)
    expect(getKek()).toBeDefined()
  })

  it('returns false when no lock is configured', async () => {
    await expect(unlockLock('anything')).resolves.toBe(false)
  })
})

describe('sealed slots', () => {
  it('returns no wrap key while locked and a sealed one after unlock', async () => {
    await enableLock('pw')
    setKek(undefined)
    // a slot that materializes while locked must not appear
    await expect(loadWrapKey(OM_KEY)).resolves.toBeUndefined()
    expect(fake.data.get('kv')?.get(OM_KEY)).toBeUndefined()

    await unlockLock('pw')
    const key = await loadWrapKey(OM_KEY)
    expect(key).toBeDefined()
    // the stored form is the sealed blob, not a raw CryptoKey
    const stored = fake.data.get('kv')?.get(OM_KEY)
    expect(isWrappedKeyRecord(stored)).toBe(true)
    // and the blob does not reopen without the KEK
    setKek(undefined)
    const reloaded = await loadWrapKey(OM_KEY)
    expect(reloaded).toBeUndefined()
  })

  it('migrates legacy plaintext slots and their records on enable', async () => {
    const { omKey } = await seedLegacy()
    const legacyRecord = fake.data.get('omemo')?.get(`badinage:${JID}:om:ident`)
    expect(isWrappedRecord(legacyRecord)).toBe(true)

    await enableLock('pw')

    // legacy keys are gone, sealed blobs took their place
    expect(isWrappedKeyRecord(fake.data.get('kv')?.get(OM_KEY))).toBe(true)
    expect(isWrappedKeyRecord(fake.data.get('kv')?.get(MSGS_KEY))).toBe(true)

    // records decrypt under the new slot keys but not the old ones
    const newOm = (await loadWrapKey(OM_KEY)) as CryptoKey
    const newMsgs = (await loadWrapKey(MSGS_KEY)) as CryptoKey
    const omRecord = fake.data.get('omemo')?.get(`badinage:${JID}:om:ident`)
    const msgRecord = fake.data.get('messages')?.get(`badinage:${JID}:msgs:juliet@example.net`)
    await expect(decryptRecord(newOm, omRecord as never)).resolves.toEqual({ pk: 1 })
    await expect(decryptRecord(newMsgs, msgRecord as never)).resolves.toEqual([
      { id: 'm1', body: 'hi' }
    ])
    await expect(decryptRecord(omKey, omRecord as never)).rejects.toThrow()
  })

  it('resumes an interrupted migration on the next unlock', async () => {
    const { omKey } = await seedLegacy()
    await enableLock('pw')
    // simulate a crash mid-enable: a fresh legacy slot appears after
    // the first migration pass ran
    const stale = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt'
    ])
    await fake.idb.set('kv', 'badinage:mercutio@example.net:omemo-wrap', stale)
    await fake.idb.set(
      'omemo',
      'badinage:mercutio@example.net:om:ident',
      await encryptRecord(stale, { pk: 9 })
    )
    setKek(undefined)

    await unlockLock('pw')
    expect(
      isWrappedKeyRecord(fake.data.get('kv')?.get('badinage:mercutio@example.net:omemo-wrap'))
    ).toBe(true)
    const key = (await loadWrapKey('badinage:mercutio@example.net:omemo-wrap')) as CryptoKey
    const rec = fake.data.get('omemo')?.get('badinage:mercutio@example.net:om:ident')
    await expect(decryptRecord(key, rec as never)).resolves.toEqual({ pk: 9 })
    expect(omKey).toBeDefined()
  })
})

describe('changePassphrase + disableLock', () => {
  it('rewraps slots so the old passphrase fails and records survive', async () => {
    await seedLegacy()
    await enableLock('first')
    const before = fake.data.get('omemo')?.get(`badinage:${JID}:om:ident`)

    await expect(changePassphrase('wrong', 'second')).resolves.toBe(false)
    await expect(changePassphrase('first', 'second')).resolves.toBe(true)

    // records untouched - the same ciphertext still decrypts
    setKek(undefined)
    await expect(unlockLock('first')).resolves.toBe(false)
    await expect(unlockLock('second')).resolves.toBe(true)
    const key = (await loadWrapKey(OM_KEY)) as CryptoKey
    await expect(decryptRecord(key, before as never)).resolves.toEqual({ pk: 1 })
  })

  it('restores plaintext slots on disable', async () => {
    await seedLegacy()
    await enableLock('pw')
    await disableLock()

    expect(await lockConfig()).toBeUndefined()
    expect(getKek()).toBeUndefined()
    const stored = fake.data.get('kv')?.get(OM_KEY)
    expect(isWrappedKeyRecord(stored)).toBe(false)
    expect(stored).toBeDefined()
    // and the records read under the restored plaintext key
    const rec = fake.data.get('omemo')?.get(`badinage:${JID}:om:ident`)
    await expect(decryptRecord(stored as CryptoKey, rec as never)).resolves.toEqual({ pk: 1 })
  })
})

describe('sealed sessions', () => {
  it('writes sealed session blobs while the lock is enabled', async () => {
    await enableLock('pw')
    await saveSession({ jid: `${JID}/web`, password: 'secret', remember: true })
    const raw = sessionStorage.getItem(`badinage:${JID}:session`)
    expect(raw).not.toContain('secret')
    expect(isWrappedRecord(JSON.parse(raw ?? ''))).toBe(true)
  })

  it('leaves sealed sessions for the unlock path when locked', async () => {
    await enableLock('pw')
    await saveSession({ jid: `${JID}/web`, password: 'secret', remember: true })
    setKek(undefined)
    await expect(restoreSessions()).resolves.toEqual([])
    // nothing dropped: after unlock the same blob restores
    await unlockLock('pw')
    await expect(restoreSessions()).resolves.toEqual([
      { jid: `${JID}/web`, password: 'secret', remember: true }
    ])
  })

  it('seals plaintext sessions on enable and unseals on disable', async () => {
    await saveSession({ jid: `${JID}/web`, password: 'secret', remember: true })
    expect(sessionStorage.getItem(`badinage:${JID}:session`)).toContain('secret')

    await enableLock('pw')
    expect(sessionStorage.getItem(`badinage:${JID}:session`)).not.toContain('secret')

    await disableLock()
    expect(sessionStorage.getItem(`badinage:${JID}:session`)).toContain('secret')
  })
})
