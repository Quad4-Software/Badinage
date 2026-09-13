import { beforeEach, describe, expect, it, vi } from 'vitest'

import { scopedKey } from '$lib/core/storage/keys'

import { deleteAccountData } from './storage'

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

vi.mock('$lib/core/storage/idb', () => ({
  idb: fake.idb,
  IDB_STORES: ['kv', 'messages', 'omemo'] as const
}))

const A = 'a@x.org'
const B = 'b@x.org'

beforeEach(() => {
  fake.data.clear()
})

describe('deleteAccountData', () => {
  it('removes every record namespaced to the account across all stores', async () => {
    const idb = fake.idb
    await idb.set('messages', scopedKey(A, 'msgs', 'peer@x.org'), [{ id: '1' }])
    await idb.set('messages', scopedKey(B, 'msgs', 'peer@x.org'), [{ id: '2' }])
    await idb.set('omemo', scopedKey(A, 'om', 'ident'), { id: 'ident' })
    await idb.set('kv', scopedKey(A, 'msgs-wrap'), 'key')
    await idb.set('kv', scopedKey(A, 'omemo-wrap'), 'key')
    await idb.set('kv', 'badinage:global', 'keep')

    await deleteAccountData(A)

    const left = async (store: 'kv' | 'messages' | 'omemo') => idb.keys(store)
    for (const keys of await Promise.all([left('kv'), left('messages'), left('omemo')])) {
      for (const key of keys) {
        expect(String(key).startsWith(scopedKey(A))).toBe(false)
      }
    }
    // other accounts and global keys survive
    expect(await idb.get('messages', scopedKey(B, 'msgs', 'peer@x.org'))).toEqual([{ id: '2' }])
    expect(await idb.get('kv', 'badinage:global')).toBe('keep')
  })

  it('is a no-op when the account never persisted anything', async () => {
    await expect(deleteAccountData('ghost@x.org')).resolves.toBeUndefined()
  })
})
