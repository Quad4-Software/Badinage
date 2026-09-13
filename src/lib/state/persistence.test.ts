import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isWrappedRecord } from '$lib/core/storage/crypto'
import { scopedKey } from '$lib/core/storage/keys'

import { createConversation, emptyMessage } from './conversation.svelte'
import { ConversationPersistence } from './persistence.svelte'

// Map-backed IndexedDB stand-in so wrapped records and the kv wrap key
// behave like real storage: the CryptoKey comes back as the same object,
// which matches how structured clone hands CryptoKeys around.
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

const ACCOUNT = 'me@example.net'
const PEER = 'peer@example.net'
const MSG_KEY = scopedKey(ACCOUNT, 'msgs', PEER)
const WRAP_KEY = scopedKey(ACCOUNT, 'msgs-wrap')

function conversation(body: string) {
  const conv = createConversation(PEER, 'dm')
  conv.messages.push({ ...emptyMessage(PEER), id: `m-${body}`, body })
  return conv
}

const stored = () => fake.data.get('messages')?.get(MSG_KEY)

beforeEach(() => {
  fake.data.clear()
})

describe('ConversationPersistence envelope', () => {
  it('stores ciphertext at rest and loads it back', async () => {
    const persistence = new ConversationPersistence(ACCOUNT)
    persistence.schedule(conversation('hello'))
    await persistence.flush()

    const raw = stored()
    expect(isWrappedRecord(raw)).toBe(true)
    expect(JSON.stringify(raw)).not.toContain('hello')

    const loaded = await persistence.load(PEER)
    expect(loaded).toHaveLength(1)
    expect(loaded?.[0]?.body).toBe('hello')
  })

  it('migrates plaintext snapshots: loads them, then rewrites wrapped', async () => {
    const legacy = [{ ...emptyMessage(PEER), id: 'old-1', body: 'legacy' }]
    await fake.idb.set('messages', MSG_KEY, legacy)

    const persistence = new ConversationPersistence(ACCOUNT)
    const loaded = await persistence.load(PEER)
    expect(loaded?.[0]?.body).toBe('legacy')

    // the rewrap is fire-and-forget inside load
    await vi.waitFor(() => {
      expect(isWrappedRecord(stored())).toBe(true)
    })
    // and the wrapped copy still decodes
    const again = await persistence.load(PEER)
    expect(again?.[0]?.body).toBe('legacy')
  })

  it('fails closed on a corrupted record and drops it', async () => {
    await fake.idb.set('messages', MSG_KEY, {
      __enc: 1,
      iv: 'AAAAAAAAAAAAAAAA',
      data: 'AAAA'
    })

    const persistence = new ConversationPersistence(ACCOUNT)
    await expect(persistence.load(PEER)).resolves.toBeUndefined()
    expect(stored()).toBeUndefined()
  })

  it('fails closed when the wrap key was lost, writes recover with a fresh key', async () => {
    const persistence = new ConversationPersistence(ACCOUNT)
    persistence.schedule(conversation('first'))
    await persistence.flush()
    expect(isWrappedRecord(stored())).toBe(true)

    // simulate the kv wrap key disappearing mid-lifecycle
    fake.data.get('kv')?.clear()

    await expect(persistence.load(PEER)).resolves.toBeUndefined()
    expect(stored()).toBeUndefined()

    persistence.schedule(conversation('second'))
    await persistence.flush()
    const raw = stored()
    expect(isWrappedRecord(raw)).toBe(true)
    const loaded = await persistence.load(PEER)
    expect(loaded?.[0]?.body).toBe('second')
    // a fresh key was generated and stored
    expect(fake.data.get('kv')?.has(WRAP_KEY)).toBe(true)
  })

  it('returns undefined for peers with no snapshot', async () => {
    const persistence = new ConversationPersistence(ACCOUNT)
    await expect(persistence.load('nobody@example.net')).resolves.toBeUndefined()
  })
})

describe('ConversationPersistence untrusted veto', () => {
  it('never reads or writes storage when persist is false', async () => {
    const persistence = new ConversationPersistence(ACCOUNT, false)

    // even a pre-existing record is invisible to an untrusted session
    await fake.idb.set('messages', MSG_KEY, [{ ...emptyMessage(PEER), id: 'x', body: 'old' }])
    await expect(persistence.load(PEER)).resolves.toBeUndefined()

    persistence.schedule(conversation('secret'))
    await persistence.flush()

    // nothing landed anywhere: no snapshot, no wrap key
    expect(fake.data.get('kv')?.size ?? 0).toBe(0)
    expect(stored()).toEqual([expect.objectContaining({ id: 'x', body: 'old' })])
  })
})
