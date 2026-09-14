// App lock: a user passphrase derives an AES-GCM key encryption key via
// PBKDF2. While enabled, every per-slot record wrap key is stored sealed
// under the KEK instead of as a raw CryptoKey, so an IndexedDB dump
// yields only ciphertext. The KEK lives in module memory between unlock
// and lock - a reload seals everything again.
//
// Slot migration is resumable: a legacy plaintext CryptoKey left in kv
// means a previous enable or disable was interrupted, and the next
// unlock finishes moving its records.

import { LOCK_CANARY_TEXT, LOCK_PBKDF2_ITERATIONS, STORAGE_PREFIX } from '$lib/constants'

import {
  decryptRecord,
  encryptRecord,
  getKek,
  isWrappedKeyRecord,
  isWrappedRecord,
  LOCK_KV_KEY,
  setKek,
  unwrapSlotKey,
  wrapSlotKey,
  type LockConfig
} from '../crypto'
import { idb, type StoreName } from '../idb'
import { scopedKey } from '../keys'
import { rewrapSessions } from '../session'

async function deriveKek(passphrase: string, salt: string, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)) as BufferSource,
      iterations: iter,
      hash: 'SHA-256'
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  )
}

export async function lockConfig(): Promise<LockConfig | undefined> {
  return idb.get<LockConfig>('kv', LOCK_KV_KEY).catch(() => undefined)
}

// Every slot suffix that protects a record table, mapped to the record
// prefixes it owns. The omemo profile stores land under om and oml.
const SLOT_TARGETS: [suffix: string, store: StoreName, prefixes: (jid: string) => string[]][] = [
  [':omemo-wrap', 'omemo', (jid) => [`${scopedKey(jid, 'om')}:`, `${scopedKey(jid, 'oml')}:`]],
  [':msgs-wrap', 'messages', (jid) => [`${scopedKey(jid, 'msgs')}:`]]
]

// Re-wrap every envelope under the given record prefixes from one key
// to another. Unwrapped records (trust rows, pre-envelope data) pass
// through untouched. A record that will not decrypt was already
// orphaned under a dead key - the same fail-closed rule the read path
// applies drops it instead of aborting the whole migration.
async function rekeyRecords(
  store: StoreName,
  prefixes: string[],
  from: CryptoKey,
  to: CryptoKey
): Promise<void> {
  for (const key of await idb.keys(store)) {
    if (typeof key !== 'string' || !prefixes.some((p) => key.startsWith(p))) continue
    const raw = await idb.get(store, key)
    if (!isWrappedRecord(raw)) continue
    try {
      const plain = await decryptRecord(from, raw)
      await idb.set(store, key, await encryptRecord(to, plain))
    } catch {
      await idb.del(store, key)
    }
  }
}

// Finish any interrupted migration: a plaintext CryptoKey sitting in a
// wrap slot while the lock is enabled means its records still live
// under that key. Move them under a fresh KEK-sealed key.
async function resumePendingSlots(): Promise<void> {
  const kek = getKek()
  if (!kek) return
  for (const kvKey of await idb.keys('kv')) {
    if (typeof kvKey !== 'string' || !kvKey.startsWith(`${STORAGE_PREFIX}:`)) continue
    const target = SLOT_TARGETS.find(([suffix]) => kvKey.endsWith(suffix))
    if (!target) continue
    const stored = await idb.get('kv', kvKey)
    if (!stored || isWrappedKeyRecord(stored)) continue
    const jid = kvKey.split(':')[1]
    if (jid === undefined) continue
    const [, store, prefixes] = target
    const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt'
    ])
    await rekeyRecords(store, prefixes(jid), stored as CryptoKey, fresh)
    await idb.set('kv', kvKey, await wrapSlotKey(fresh, kek))
  }
}

export async function enableLock(passphrase: string): Promise<void> {
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  const kek = await deriveKek(passphrase, salt, LOCK_PBKDF2_ITERATIONS)
  const config: LockConfig = {
    v: 1,
    salt,
    iter: LOCK_PBKDF2_ITERATIONS,
    canary: await encryptRecord(kek, LOCK_CANARY_TEXT)
  }
  // the config lands first so an interrupted enable still finds the
  // salt it needs to resume migrating legacy slots on the next unlock
  await idb.set('kv', LOCK_KV_KEY, config)
  setKek(kek)
  await resumePendingSlots()
  await rewrapSessions(true)
}

// Verify the passphrase against the canary, install the KEK and finish
// pending slot migrations. Returns false on a wrong passphrase.
export async function unlockLock(passphrase: string): Promise<boolean> {
  const config = await lockConfig()
  if (!config) return false
  const kek = await deriveKek(passphrase, config.salt, config.iter)
  try {
    const plain = await decryptRecord<string>(kek, config.canary)
    if (plain !== LOCK_CANARY_TEXT) return false
  } catch {
    return false
  }
  setKek(kek)
  await resumePendingSlots()
  return true
}

// Rewrap every slot blob under a new passphrase without touching the
// records the slot keys protect. Verifies the current passphrase first.
export async function changePassphrase(current: string, next: string): Promise<boolean> {
  const config = await lockConfig()
  if (!config || !getKek()) return false
  const check = await deriveKek(current, config.salt, config.iter)
  try {
    if ((await decryptRecord<string>(check, config.canary)) !== LOCK_CANARY_TEXT) return false
  } catch {
    return false
  }
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  const kek = await deriveKek(next, salt, LOCK_PBKDF2_ITERATIONS)
  // slot keys unwrap extractable here only so the new KEK can seal them
  const oldKek = getKek() as CryptoKey
  for (const kvKey of await idb.keys('kv')) {
    if (typeof kvKey !== 'string') continue
    const stored = await idb.get('kv', kvKey)
    if (!isWrappedKeyRecord(stored)) continue
    const slot = await unwrapSlotKey(stored, oldKek, true)
    await idb.set('kv', kvKey, await wrapSlotKey(slot, kek))
  }
  setKek(kek)
  const updated: LockConfig = {
    v: 1,
    salt,
    iter: LOCK_PBKDF2_ITERATIONS,
    canary: await encryptRecord(kek, LOCK_CANARY_TEXT)
  }
  await idb.set('kv', LOCK_KV_KEY, updated)
  return true
}

// Return every slot to a plaintext CryptoKey and drop the lock config.
// Requires the KEK to be resident, so callers must be unlocked.
export async function disableLock(): Promise<void> {
  const kek = getKek()
  if (!kek) return
  for (const kvKey of await idb.keys('kv')) {
    if (typeof kvKey !== 'string' || !kvKey.startsWith(`${STORAGE_PREFIX}:`)) continue
    const target = SLOT_TARGETS.find(([suffix]) => kvKey.endsWith(suffix))
    if (!target) continue
    const stored = await idb.get('kv', kvKey)
    if (!isWrappedKeyRecord(stored)) continue
    const jid = kvKey.split(':')[1]
    if (jid === undefined) continue
    const [, store, prefixes] = target
    const sealed = await unwrapSlotKey(stored, kek)
    const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt'
    ])
    await rekeyRecords(store, prefixes(jid), sealed, fresh)
    await idb.set('kv', kvKey, fresh)
  }
  await idb.del('kv', LOCK_KV_KEY)
  await rewrapSessions(false)
  setKek(undefined)
}
