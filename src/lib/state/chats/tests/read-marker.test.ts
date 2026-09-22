import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Emitter } from '$lib/core/events'
import type { ChatConnection, ConnectionEvents } from '$lib/core/xmpp/connection'
import type { IncomingMessage } from '$lib/core/xmpp/stanzas'

import { ChatStore } from '../chats.svelte'

// persistence goes through core/storage/idb, which needs indexedDB. The
// store only schedules debounced writes and a hydrate read, so an
// in-memory stand-in keeps the ingest path fully exercised.
vi.mock('$lib/core/storage/idb', () => ({
  idb: {
    get: vi.fn(() => Promise.resolve(undefined)),
    set: vi.fn(() => Promise.resolve(undefined)),
    del: vi.fn(() => Promise.resolve(undefined)),
    keys: vi.fn(() => Promise.resolve([])),
    clear: vi.fn(() => Promise.resolve(undefined))
  }
}))

function fakeConnection(): ChatConnection {
  return {
    events: new Emitter<ConnectionEvents>(),
    connected: true,
    jid: 'me@example.net/web'
  } as unknown as ChatConnection
}

const PEER = 'peer@irc.example.org'

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    from: PEER,
    to: 'me@irc.example.org',
    body: 'hello',
    type: 'chat',
    ...overrides
  }
}

let store: ChatStore
let connection: ChatConnection

beforeEach(() => {
  vi.useFakeTimers()
  store = new ChatStore('me@irc.example.org')
  connection = fakeConnection()
  connection.events.on('message', (message) => store.ingest(message, null))
})

afterEach(() => {
  store.dispose()
  vi.useRealTimers()
})

// IRC draft/read-marker advances a timestamp cursor instead of naming
// a stanza, the way XEP-0490 mds does
describe('markDisplayedBefore', () => {
  it('marks incoming messages at or before the timestamp read', () => {
    const early = Date.parse('2024-01-01T10:00:00Z')
    const late = Date.parse('2024-01-01T12:00:00Z')
    store.ingest(incoming({ delay: early }), null)
    store.ingest(incoming({ delay: late }), null)
    const conversation = store.conversations.get(PEER)
    expect(conversation?.unread).toBe(2)

    store.markDisplayedBefore(PEER, Date.parse('2024-01-01T11:00:00Z'))

    expect(conversation?.messages[0]?.read).toBe(true)
    expect(conversation?.messages[1]?.read).toBe(false)
    expect(conversation?.unread).toBe(1)
  })

  it('ignores outgoing messages and unknown peers', () => {
    store.ingest(incoming({ from: 'me@irc.example.org', to: PEER }), null)
    store.markDisplayedBefore(PEER, Date.now())
    const conversation = store.conversations.get(PEER)
    expect(conversation?.unread).toBe(0)
    store.markDisplayedBefore('ghost@irc.example.org', Date.now())
  })
})
