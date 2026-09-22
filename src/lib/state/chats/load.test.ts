import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Emitter } from '$lib/core/events'
import { LIVE_MESSAGE_CAP } from '$lib/constants'
import type { ChatConnection, ConnectionEvents } from '$lib/core/xmpp/connection'
import type { IncomingMessage } from '$lib/core/xmpp/stanzas'

import { ChatStore } from '../chats.svelte'

// Load tests: drive the store the way a real connection does, through
// emitted message events, at volumes a busy account actually sees. The
// budgets are generous so slow CI still passes - they exist to catch
// quadratic regressions and unbounded growth, not to micro-benchmark.
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

function fakeConnection(): ChatConnection {
  return {
    events: new Emitter<ConnectionEvents>(),
    connected: true,
    jid: 'me@example.net/web'
  } as unknown as ChatConnection
}

function stanza(peer: string, index: number, timestamp: number): IncomingMessage {
  return {
    from: `${peer}/phone`,
    to: ACCOUNT,
    body: `load message ${index}`,
    type: 'chat',
    stanzaId: `${peer}:s${index}`,
    delay: timestamp
  }
}

let store: ChatStore
let connection: ChatConnection

beforeEach(() => {
  vi.useFakeTimers()
  store = new ChatStore(ACCOUNT)
  connection = fakeConnection()
  connection.events.on('message', (message) => store.ingest(message, null))
})

afterEach(() => {
  store.dispose()
  vi.useRealTimers()
})

describe('ChatStore under load', () => {
  it('ingests 5000 messages across 200 conversations without degrading', () => {
    const peers = Array.from({ length: 200 }, (_, i) => `peer${i}@example.net`)
    const start = performance.now()
    let n = 0
    for (let round = 0; round < 25; round++) {
      for (const peer of peers) {
        connection.events.emit('message', stanza(peer, n++, 1_000_000 + n))
      }
    }
    const elapsed = performance.now() - start

    expect(store.conversations.size).toBe(200)
    let total = 0
    for (const conversation of store.conversations.values()) {
      expect(conversation.unread).toBe(25)
      total += conversation.messages.length
    }
    expect(total).toBe(5000)
    // quadratic ingest would blow past this on any CI runner
    expect(elapsed).toBeLessThan(10_000)
  })

  it('keeps one hot conversation bounded at the live cap', () => {
    const start = performance.now()
    for (let i = 0; i < 3000; i++) {
      connection.events.emit('message', stanza('peer@example.net', i, i))
    }
    const elapsed = performance.now() - start
    const conversation = store.conversations.get('peer@example.net')
    expect(conversation?.messages.length).toBe(LIVE_MESSAGE_CAP)
    // tail trimming must keep order: the last message is the newest
    expect(conversation?.messages.at(-1)?.id).toBe('peer@example.net:s2999')
    expect(elapsed).toBeLessThan(10_000)
  })

  it('keeps out-of-order floods sorted without quadratic cost', () => {
    const peer = 'peer@example.net'
    const messages = 2000
    // reversed delivery: worst case for the insertion path
    const start = performance.now()
    for (let i = messages - 1; i >= 0; i--) {
      connection.events.emit('message', stanza(peer, i, i))
    }
    const elapsed = performance.now() - start
    const list = store.conversations.get(peer)?.messages ?? []
    for (let i = 1; i < list.length; i++) {
      expect(list[i]?.timestamp ?? 0).toBeGreaterThanOrEqual(list[i - 1]?.timestamp ?? 0)
    }
    // a linear back-scan would be ~2M comparisons here while bisect keeps
    // this comfortably under a second
    expect(elapsed).toBeLessThan(3_000)
  })

  it('bounds heap growth while ingesting', () => {
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < 5000; i++) {
      connection.events.emit('message', stanza('peer@example.net', i, i))
    }
    const growth = process.memoryUsage().heapUsed - before
    // a capped conversation plus dedup state should cost tens of MB at
    // most. A leak in the ingest path would run away here
    expect(growth).toBeLessThan(200 * 1024 * 1024)
    expect(store.conversations.get('peer@example.net')?.messages.length).toBe(LIVE_MESSAGE_CAP)
  })

  it('handles a reaction storm against a full conversation', () => {
    const peer = 'peer@example.net'
    for (let i = 0; i < 500; i++) {
      connection.events.emit('message', stanza(peer, i, i))
    }
    const start = performance.now()
    for (let i = 0; i < 2000; i++) {
      connection.events.emit('message', {
        from: `${peer}/phone`,
        to: ACCOUNT,
        body: '',
        type: 'chat',
        stanzaId: `react-${i}`,
        reactionTo: { id: `${peer}:s${i % 500}`, emojis: ['👍'] }
      })
    }
    const elapsed = performance.now() - start
    const conversation = store.conversations.get(peer)
    expect(conversation?.messages.length).toBe(500)
    // each target is hit four times but the same sender dedups to one pill
    expect(conversation?.messages[0]?.reactions['👍']).toHaveLength(1)
    expect(elapsed).toBeLessThan(5_000)
  })
})
