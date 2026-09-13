import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LIVE_MESSAGE_CAP } from '$lib/constants'

import { ChatStore } from '../chats.svelte'
import { emptyMessage } from '../conversation.svelte'
import type { ChatMessage } from '../conversation.svelte'

// persistence goes through core/storage/idb, which needs indexedDB. The
// store only schedules debounced writes and a hydrate read, so an
// in-memory stand-in keeps the push path fully exercised.
vi.mock('$lib/core/storage/idb', () => ({
  idb: {
    get: vi.fn(() => Promise.resolve(undefined)),
    set: vi.fn(() => Promise.resolve(undefined)),
    del: vi.fn(() => Promise.resolve(undefined)),
    keys: vi.fn(() => Promise.resolve([])),
    clear: vi.fn(() => Promise.resolve(undefined))
  }
}))

const ACCOUNT = 'me@example.net'
const PEER = 'peer@example.net'

function message(id: string, timestamp: number): ChatMessage {
  return { ...emptyMessage(PEER), id, body: id, timestamp, delivered: true, read: true }
}

let store: ChatStore

beforeEach(() => {
  vi.useFakeTimers()
  store = new ChatStore(ACCOUNT)
})

afterEach(() => {
  store.dispose()
  vi.useRealTimers()
})

describe('live message cap', () => {
  it('trims the oldest messages when tail appends pass the cap', () => {
    for (let i = 0; i < LIVE_MESSAGE_CAP + 25; i++) {
      expect(store.push(PEER, message(`m${i}`, i))).toBe(true)
    }
    const messages = store.open(PEER).messages
    expect(messages.length).toBe(LIVE_MESSAGE_CAP)
    expect(messages[0]?.id).toBe('m25')
    expect(messages.at(-1)?.id).toBe(`m${LIVE_MESSAGE_CAP + 24}`)
  })

  it('does not trim on inserts older than the tail', () => {
    for (let i = 0; i < LIVE_MESSAGE_CAP; i++) {
      store.push(PEER, message(`m${i}`, i))
    }
    // an archive page lands at the front with older timestamps and must
    // not evict itself
    for (let i = 0; i < 50; i++) {
      store.push(PEER, message(`old${i}`, -1000 + i))
    }
    expect(store.open(PEER).messages.length).toBe(LIVE_MESSAGE_CAP + 50)
  })

  it('releases trimmed ids from dedup so refetches can re-add them', () => {
    for (let i = 0; i < LIVE_MESSAGE_CAP + 10; i++) {
      store.push(PEER, message(`m${i}`, i))
    }
    // m0 through m9 were trimmed. A re-delivery of a trimmed id is not a
    // duplicate anymore, it is scroll-back history landing at the front
    expect(store.push(PEER, message('m5', 5))).toBe(true)
    expect(store.open(PEER).messages.length).toBe(LIVE_MESSAGE_CAP + 1)
    // ids still live in the list stay deduplicated
    expect(store.push(PEER, message(`m${LIVE_MESSAGE_CAP}`, 0))).toBe(false)
  })

  it('releases every alias a trimmed message registered', () => {
    // m0 arrives with a second alias, like a stanza carrying both a
    // stanza-id and an origin-id. Both land in the dedup set
    store.push(PEER, message('m0', 0), false, ['m0-alias'])
    for (let i = 1; i <= LIVE_MESSAGE_CAP + 5; i++) {
      store.push(PEER, message(`m${i}`, i))
    }
    // m0 is trimmed. Its alias must leave the dedup set too, or a
    // refetch carrying it is swallowed as a duplicate
    expect(store.push(PEER, message('m0', 0), false, ['m0-alias'])).toBe(true)
  })
})
