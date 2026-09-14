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
export async function loadWrapKey(kvKey: string): Promise<CryptoKey | undefined> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return undefined
  const existing = await idb.get<CryptoKey>('kv', kvKey)
  if (existing) return existing
  const generated = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
  await idb.set('kv', kvKey, generated)
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
