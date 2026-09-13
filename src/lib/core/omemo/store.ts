// Persistence adapter implementing the omemo package's OmemoStore contract
// over IndexedDB. Key material is wrapped with a non-extractable AES-GCM
// key kept in the kv store so raw private keys never appear in the
// database in plain form.

import {
  decodeRecord,
  decryptRecord,
  encodeRecord,
  encryptRecord,
  isWrappedRecord,
  loadWrapKey
} from '$lib/core/storage/crypto'
import { idb } from '$lib/core/storage/idb'
import { scopedKey } from '$lib/core/storage/keys'
import type { TrustStore, TrustRecord } from './trust'

import { sessionKey } from '@quad4-software/omemo'
import type { IdentityRecord, KeyPair, OmemoStore, SignedPreKeyRecord } from '@quad4-software/omemo'
import type { SessionData } from '@quad4-software/omemo'

// The wrapping key lives in the kv store as a structured-cloned
// non-extractable CryptoKey. Without a user passphrase this is a
// best-effort barrier: the key bytes themselves never appear in storage,
// which is what the repo's at-rest rule is about.
async function wrapKeyFor(accountJid: string): Promise<CryptoKey | undefined> {
  return loadWrapKey(scopedKey(accountJid, 'omemo-wrap'))
}

export class IdbOmemoStore implements OmemoStore {
  // False when the AES-GCM wrap key could not be created or loaded, meaning
  // key material is stored unwrapped. The store stays functional either
  // way; callers should surface this instead of assuming at-rest
  // encryption.
  readonly secure: boolean
  // Why secure is false: WebCrypto subtle missing, or the error raised
  // while generating or loading the wrap key. Undefined when secure.
  readonly keyWrapError: unknown

  private constructor(
    private readonly prefix: string,
    private readonly wrapKey: CryptoKey | undefined,
    keyWrapError: unknown
  ) {
    this.secure = wrapKey !== undefined
    this.keyWrapError = keyWrapError
  }

  static async create(accountJid: string): Promise<IdbOmemoStore> {
    let wrapKey: CryptoKey | undefined
    let keyWrapError: unknown
    try {
      wrapKey = await wrapKeyFor(accountJid)
      if (wrapKey === undefined) keyWrapError = new Error('WebCrypto subtle is unavailable')
    } catch (error) {
      keyWrapError = error
    }
    if (keyWrapError !== undefined) {
      console.warn(
        'omemo key wrapping unavailable, storing key material unwrapped:',
        keyWrapError instanceof Error ? keyWrapError.message : String(keyWrapError)
      )
    }
    return new IdbOmemoStore(scopedKey(accountJid, 'om'), wrapKey, keyWrapError)
  }

  private k(...parts: (string | number)[]): string {
    return `${this.prefix}:${parts.join(':')}`
  }

  private async getRecord<T>(key: string): Promise<T | undefined> {
    const raw = await idb.get<unknown>('omemo', key)
    if (raw === undefined) return undefined
    if (!isWrappedRecord(raw)) return raw as T
    if (!this.wrapKey) return undefined
    return decryptRecord<T>(this.wrapKey, raw)
  }

  private async putRecord(key: string, value: unknown): Promise<void> {
    if (!this.wrapKey) {
      await idb.set('omemo', key, decodeRecord(encodeRecord(value)))
      return
    }
    await idb.set('omemo', key, await encryptRecord(this.wrapKey, value))
  }

  private async listByPrefix(prefix: string): Promise<string[]> {
    const keys = await idb.keys('omemo')
    const full = `${this.prefix}:${prefix}`
    return keys.filter((k): k is string => typeof k === 'string' && k.startsWith(full))
  }

  getIdentity(): Promise<IdentityRecord | undefined> {
    return this.getRecord(this.k('ident'))
  }

  putIdentity(record: IdentityRecord): Promise<void> {
    return this.putRecord(this.k('ident'), record)
  }

  getSignedPreKey(id: number): Promise<SignedPreKeyRecord | undefined> {
    return this.getRecord(this.k('spk', id))
  }

  putSignedPreKey(record: SignedPreKeyRecord): Promise<void> {
    return this.putRecord(this.k('spk', record.id), record)
  }

  async listSignedPreKeyIds(): Promise<number[]> {
    return (await this.listByPrefix('spk:')).map((k) => Number(k.split(':').pop()))
  }

  removeSignedPreKey(id: number): Promise<void> {
    return idb.del('omemo', this.k('spk', id))
  }

  getPreKey(id: number): Promise<KeyPair | undefined> {
    return this.getRecord(this.k('pk', id))
  }

  putPreKey(id: number, pair: KeyPair): Promise<void> {
    return this.putRecord(this.k('pk', id), pair)
  }

  removePreKey(id: number): Promise<void> {
    return idb.del('omemo', this.k('pk', id))
  }

  async listPreKeyIds(): Promise<number[]> {
    return (await this.listByPrefix('pk:')).map((k) => Number(k.split(':').pop()))
  }

  getSession(jid: string, deviceId: number): Promise<SessionData | undefined> {
    return this.getRecord(this.k('sess', sessionKey(jid, deviceId)))
  }

  putSession(jid: string, deviceId: number, data: SessionData): Promise<void> {
    return this.putRecord(this.k('sess', sessionKey(jid, deviceId)), data)
  }

  deleteSession(jid: string, deviceId: number): Promise<void> {
    return idb.del('omemo', this.k('sess', sessionKey(jid, deviceId)))
  }

  getDeviceIds(jid: string): Promise<number[] | undefined> {
    return this.getRecord(this.k('dev', jid))
  }

  putDeviceIds(jid: string, ids: number[]): Promise<void> {
    return this.putRecord(this.k('dev', jid), ids)
  }
}

// Trust records are public fingerprints rather than key material, so they
// live unwrapped in the same store under their own prefix.
export class IdbTrustStore implements TrustStore {
  constructor(private readonly accountJid: string) {}

  private key(jid: string, deviceId: number): string {
    return scopedKey(this.accountJid, 'om', 'trust', jid, String(deviceId))
  }

  async put(record: TrustRecord): Promise<void> {
    await idb.set('omemo', this.key(record.jid, record.deviceId), record)
  }

  async all(): Promise<TrustRecord[]> {
    const prefix = scopedKey(this.accountJid, 'om', 'trust')
    const keys = await idb.keys('omemo')
    const out: TrustRecord[] = []
    for (const key of keys) {
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue
      const record = await idb.get<TrustRecord>('omemo', key)
      if (record) out.push(record)
    }
    return out
  }
}
