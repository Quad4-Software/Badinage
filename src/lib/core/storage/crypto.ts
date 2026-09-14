// AES-GCM envelope for records stored in IndexedDB. A non-extractable
// CryptoKey is kept in the kv store via structured clone and every
// wrapped record carries a random iv plus ciphertext. The pattern is
// shared between the OMEMO store and conversation snapshots.
//
// Documented trade-off: without a user passphrase the wrap key lives in
// the same database as the records it protects. A stolen IndexedDB dump
// yields ciphertext and a key blob, not plaintext key bytes, but an
// attacker who can run our code against the same profile can still
// unwrap. This is a barrier against casual inspection and offline
// dumps, not a vault. The account lock screen in TODO.md is the real
// fix.

import { base64Decode, base64Encode, randomBytes } from '@quad4-software/badinage-omemo'

import { idb } from './idb'
import { globalKey } from './keys'

// App lock: when a lock config exists the per-slot wrap keys are stored
// KEK-wrapped and the KEK lives only in memory between unlock and lock.
export const LOCK_KV_KEY = globalKey('lock')

export interface LockConfig {
  v: 1
  salt: string
  iter: number
  canary: WrappedRecord
}

// A wrap key stored encrypted under the passphrase-derived KEK instead
// of as a structured-cloned CryptoKey.
export interface WrappedKeyRecord {
  __key: 1
  iv: string
  data: string
}

export function isWrappedKeyRecord(value: unknown): value is WrappedKeyRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as WrappedKeyRecord).__key === 1 &&
    typeof (value as WrappedKeyRecord).iv === 'string' &&
    typeof (value as WrappedKeyRecord).data === 'string'
  )
}

// The passphrase-derived key encryption key. Module memory only - a
// reload or an explicit lock drops it and every slot key stays sealed.
let kek: CryptoKey | undefined

export function setKek(key: CryptoKey | undefined): void {
  kek = key
}

export function getKek(): CryptoKey | undefined {
  return kek
}

// Envelope shape: version tag, base64 iv, base64 ciphertext. Records
// without the tag predate wrapping and are treated as plaintext so old
// caches keep loading.
export interface WrappedRecord {
  __enc: 1
  iv: string
  data: string
}

export function isWrappedRecord(value: unknown): value is WrappedRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as WrappedRecord).__enc === 1 &&
    typeof (value as WrappedRecord).iv === 'string' &&
    typeof (value as WrappedRecord).data === 'string'
  )
}

// JSON does not round-trip Uint8Array, so byte fields are encoded
// explicitly with a $u8 marker.
export function encodeRecord(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v instanceof Uint8Array ? { $u8: base64Encode(v) } : v
  )
}

export function decodeRecord<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (typeof v === 'object' && v !== null && '$u8' in (v as object)) {
      return base64Decode((v as { $u8: string }).$u8)
    }
    return v
  }) as T
}

// Load the wrap key stored under the given kv key, generating a fresh
// non-extractable AES-256-GCM key when none exists. Returns undefined
// when WebCrypto subtle is unavailable. Callers decide whether
// plaintext storage is acceptable or the record must be dropped.
// Callers pass a fully scoped key (scopedKey(jid, ...)) so every
// account gets its own key.
//
// When the app lock is enabled the slot holds a KEK-wrapped key blob
// instead of a CryptoKey. While locked (no KEK in memory) this returns
// undefined so every wrapped record stays sealed. A legacy plaintext
// CryptoKey under lock means a migration is pending - it is returned
// so its records stay readable until the unlock path re-keys them.
export async function loadWrapKey(kvKey: string): Promise<CryptoKey | undefined> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return undefined
  const locked = (await idb.get<LockConfig>('kv', LOCK_KV_KEY)) !== undefined
  const existing = await idb.get<CryptoKey | WrappedKeyRecord>('kv', kvKey)
  if (locked) {
    if (!kek) return undefined
    if (isWrappedKeyRecord(existing)) return unwrapSlotKey(existing, kek)
    if (existing) return existing
    return generateSlotKey(kvKey)
  }
  if (existing && !isWrappedKeyRecord(existing)) return existing
  const generated = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
  await idb.set('kv', kvKey, generated)
  return generated
}

// Unwrap a slot key blob with the given KEK. The result is marked
// extractable only when rewrapping for a passphrase change - record
// use keeps it non-extractable.
export async function unwrapSlotKey(
  record: WrappedKeyRecord,
  kek: CryptoKey,
  extractable = false
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    base64Decode(record.data) as BufferSource,
    kek,
    { name: 'AES-GCM', iv: base64Decode(record.iv) as BufferSource },
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  )
}

// Wrap a slot key for storage under the given KEK.
export async function wrapSlotKey(key: CryptoKey, kek: CryptoKey): Promise<WrappedKeyRecord> {
  const iv = randomBytes(12)
  const data = await crypto.subtle.wrapKey('raw', key, kek, {
    name: 'AES-GCM',
    iv: iv as BufferSource
  })
  return { __key: 1, iv: base64Encode(iv), data: base64Encode(new Uint8Array(data)) }
}

// Generate a fresh extractable slot key, persist it KEK-wrapped and
// return it for immediate use.
async function generateSlotKey(kvKey: string): Promise<CryptoKey> {
  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt'
  ])
  await idb.set('kv', kvKey, await wrapSlotKey(generated, kek as CryptoKey))
  return generated
}

export async function encryptRecord(key: CryptoKey, value: unknown): Promise<WrappedRecord> {
  const iv = randomBytes(12)
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(encodeRecord(value)) as BufferSource
  )
  return { __enc: 1, iv: base64Encode(iv), data: base64Encode(new Uint8Array(data)) }
}

// Rejects on tampered ciphertext or a wrong/lost key. Callers must fail
// closed: drop the record, never surface partially decoded data.
export async function decryptRecord<T>(key: CryptoKey, record: WrappedRecord): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64Decode(record.iv) as BufferSource },
    key,
    base64Decode(record.data) as BufferSource
  )
  return decodeRecord<T>(new TextDecoder().decode(plain))
}
