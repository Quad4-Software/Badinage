import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  decryptRecord,
  encodeRecord,
  decodeRecord,
  encryptRecord,
  isWrappedRecord,
  loadWrapKey
} from './crypto'

// a Map-backed stand-in for the IndexedDB facade: the wrap key lives in
// the kv store and records under test go wherever the caller puts them
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

beforeEach(() => {
  fake.data.clear()
})

describe('loadWrapKey', () => {
  it('generates a non-extractable AES-GCM key and stores it in kv', async () => {
    const key = await loadWrapKey('badinage:a@x.org:test-wrap')
    expect(key).toBeDefined()
    expect(key?.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    expect(key?.extractable).toBe(false)
    expect(fake.data.get('kv')?.get('badinage:a@x.org:test-wrap')).toBe(key)
  })

  it('reuses the stored key on the next call', async () => {
    const first = await loadWrapKey('badinage:a@x.org:test-wrap')
    const second = await loadWrapKey('badinage:a@x.org:test-wrap')
    expect(second).toBe(first)
  })

  it('keeps keys separate per scope', async () => {
    const a = await loadWrapKey('badinage:a@x.org:test-wrap')
    const b = await loadWrapKey('badinage:b@x.org:test-wrap')
    expect(a).not.toBe(b)
  })

  it('regenerates when the stored key was lost', async () => {
    const first = await loadWrapKey('badinage:a@x.org:test-wrap')
    fake.data.get('kv')?.clear()
    const second = await loadWrapKey('badinage:a@x.org:test-wrap')
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
  })

  it('returns undefined when WebCrypto subtle is unavailable', async () => {
    const original = globalThis.crypto
    vi.stubGlobal('crypto', { subtle: undefined })
    try {
      await expect(loadWrapKey('badinage:a@x.org:test-wrap')).resolves.toBeUndefined()
    } finally {
      vi.stubGlobal('crypto', original)
    }
  })
})

describe('envelope', () => {
  it('round-trips records including Uint8Array fields', async () => {
    const key = (await loadWrapKey('badinage:a@x.org:test-wrap')) as CryptoKey
    const value = {
      text: 'hello',
      bytes: new Uint8Array([1, 2, 3, 255]),
      nested: { more: new Uint8Array([9]) }
    }
    const wrapped = await encryptRecord(key, value)
    expect(isWrappedRecord(wrapped)).toBe(true)
    // no plaintext leaks into the envelope
    expect(JSON.stringify(wrapped)).not.toContain('hello')
    const plain = await decryptRecord<typeof value>(key, wrapped)
    expect(plain.text).toBe('hello')
    expect(plain.bytes).toEqual(new Uint8Array([1, 2, 3, 255]))
    expect(plain.nested.more).toEqual(new Uint8Array([9]))
  })

  it('produces a fresh iv per record', async () => {
    const key = (await loadWrapKey('badinage:a@x.org:test-wrap')) as CryptoKey
    const a = await encryptRecord(key, 'same')
    const b = await encryptRecord(key, 'same')
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })

  it('rejects tampered ciphertext', async () => {
    const key = (await loadWrapKey('badinage:a@x.org:test-wrap')) as CryptoKey
    const wrapped = await encryptRecord(key, { body: 'secret' })
    await expect(decryptRecord(key, { ...wrapped, data: 'AAAA' })).rejects.toThrow()
  })

  it('rejects under a different key (wrap-key loss)', async () => {
    const key = (await loadWrapKey('badinage:a@x.org:test-wrap')) as CryptoKey
    const wrapped = await encryptRecord(key, { body: 'secret' })
    const fresh = (await loadWrapKey('badinage:b@x.org:test-wrap')) as CryptoKey
    await expect(decryptRecord(fresh, wrapped)).rejects.toThrow()
  })
})

describe('isWrappedRecord', () => {
  it('detects the envelope shape only', () => {
    expect(isWrappedRecord({ __enc: 1, iv: 'aXY=', data: 'ZGF0YQ==' })).toBe(true)
    expect(isWrappedRecord([{ id: 'm1' }])).toBe(false)
    expect(isWrappedRecord({ __enc: 1, iv: 'aXY=' })).toBe(false)
    expect(isWrappedRecord({ __enc: 2, iv: 'aXY=', data: 'eA==' })).toBe(false)
    expect(isWrappedRecord('string')).toBe(false)
    expect(isWrappedRecord(null)).toBe(false)
    expect(isWrappedRecord(undefined)).toBe(false)
  })
})

describe('record codec', () => {
  it('round-trips plain JSON and byte fields', () => {
    const value = { a: 1, s: 'x', bytes: new Uint8Array([7, 8]) }
    const decoded = decodeRecord<typeof value>(encodeRecord(value))
    expect(decoded.a).toBe(1)
    expect(decoded.bytes).toEqual(new Uint8Array([7, 8]))
  })
})
