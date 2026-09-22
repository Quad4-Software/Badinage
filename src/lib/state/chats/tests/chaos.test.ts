import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Emitter } from '$lib/core/events'
import type { ChatConnection, ConnectionEvents } from '$lib/core/xmpp/connection'
import type { IncomingMessage } from '$lib/core/xmpp/stanzas'

import { ChatStore } from '../chats.svelte'

// Chaos spec: random legal stanza sequences - messages, reactions,
// retractions, corrections, receipts, carbons, mam redeliveries,
// occupant flaps, closes and wipes - against a few conversations.
// Invariants are checked after every op so a violation reports the
// minimal sequence that broke it.
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
const PEERS = ['alpha@example.net', 'beta@example.net', 'gamma@example.net']
const ROOM = 'den@conference.example.net'
const NICKS = ['nina', 'otto', 'pip']
// a small id pool forces real dedup and cross-reference collisions
const IDS = Array.from({ length: 40 }, (_, i) => `id-${i}`)
const EMOJIS = ['👍', '😂', '❤️']

const peerArb = fc.constantFrom(...PEERS)

const dmMsg = fc.record({
  kind: fc.constant('msg' as const),
  peer: peerArb,
  id: fc.constantFrom(...IDS),
  body: fc.string({ minLength: 0, maxLength: 40 }),
  delay: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: undefined })
})

const roomMsg = fc.record({
  kind: fc.constant('room' as const),
  nick: fc.constantFrom(...NICKS),
  id: fc.constantFrom(...IDS),
  body: fc.string({ minLength: 1, maxLength: 40 }),
  delay: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: undefined })
})

const opArb = fc.oneof(
  dmMsg,
  roomMsg,
  fc.record({
    kind: fc.constant('reaction' as const),
    peer: peerArb,
    target: fc.constantFrom(...IDS),
    emoji: fc.constantFrom(...EMOJIS)
  }),
  fc.record({
    kind: fc.constant('retract' as const),
    peer: peerArb,
    target: fc.constantFrom(...IDS)
  }),
  fc.record({
    kind: fc.constant('correct' as const),
    peer: peerArb,
    target: fc.constantFrom(...IDS),
    body: fc.string({ minLength: 1, maxLength: 30 })
  }),
  fc.record({
    kind: fc.constant('receipt' as const),
    peer: peerArb,
    target: fc.constantFrom(...IDS)
  }),
  fc.record({
    kind: fc.constant('carbon' as const),
    peer: peerArb,
    id: fc.constantFrom(...IDS),
    body: fc.string({ minLength: 1, maxLength: 30 })
  }),
  fc.record({ kind: fc.constant('close' as const), peer: peerArb }),
  fc.record({ kind: fc.constant('clear' as const), peer: peerArb }),
  fc.record({
    kind: fc.constant('occupant' as const),
    nick: fc.constantFrom(...NICKS),
    online: fc.boolean()
  })
)

type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never

function toStanza(store: ChatStore, op: Op): IncomingMessage | null {
  switch (op.kind) {
    case 'msg':
      return {
        from: `${op.peer}/phone`,
        to: ACCOUNT,
        body: op.body,
        type: 'chat',
        stanzaId: op.id,
        delay: op.delay
      }
    case 'room':
      return {
        from: `${ROOM}/${op.nick}`,
        to: ACCOUNT,
        body: op.body,
        type: 'groupchat',
        nick: op.nick,
        stanzaId: op.id,
        delay: op.delay
      }
    case 'reaction':
      return {
        from: `${op.peer}/phone`,
        to: ACCOUNT,
        body: '',
        type: 'chat',
        stanzaId: `r-${op.target}`,
        reactionTo: { id: op.target, emojis: [op.emoji] }
      }
    case 'retract':
      return {
        from: `${op.peer}/phone`,
        to: ACCOUNT,
        body: '',
        type: 'chat',
        retractId: op.target
      }
    case 'correct':
      return {
        from: `${op.peer}/phone`,
        to: ACCOUNT,
        body: op.body,
        type: 'chat',
        replaceId: op.target
      }
    case 'receipt':
      return {
        from: `${op.peer}/phone`,
        to: ACCOUNT,
        body: '',
        type: 'chat',
        receiptFor: op.target
      }
    case 'carbon':
      return {
        from: `${ACCOUNT}/desk`,
        to: op.peer,
        body: op.body,
        type: 'chat',
        carbon: 'sent',
        id: op.id,
        stanzaId: `srv-${op.id}`
      }
    case 'occupant':
      store.setOccupant(ROOM, {
        nick: op.nick,
        presence: op.online ? 'online' : 'offline',
        affiliation: 'member',
        role: 'participant',
        self: false,
        codes: []
      })
      return null
    case 'close':
      store.close(op.peer)
      return null
    case 'clear':
      store.clearHistory(op.peer)
      return null
    default:
      return null
  }
}

function assertInvariants(store: ChatStore): void {
  for (const [peer, conversation] of store.conversations) {
    expect(conversation.unread, `${peer} unread negative`).toBeGreaterThanOrEqual(0)
    const seen = new Set<string>()
    let prevTs = -Infinity
    for (const m of conversation.messages) {
      expect(seen.has(m.id), `${peer} duplicate id ${m.id}`).toBe(false)
      seen.add(m.id)
      expect(m.timestamp, `${peer} out of order`).toBeGreaterThanOrEqual(prevTs)
      prevTs = m.timestamp
      if (m.retracted) expect(m.body, `${peer} tombstone body`).toBe('')
      for (const senders of Object.values(m.reactions)) {
        expect(new Set(senders).size, `${peer} reaction sender dup`).toBe(senders.length)
      }
    }
  }
}

describe('ChatStore chaos', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps invariants through random stanza storms', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 50, maxLength: 300 }), (ops) => {
        // a fresh store per run: dedup state intentionally survives
        // clearHistory, so reuse would taint later iterations
        const store = new ChatStore(ACCOUNT)
        const connection = {
          events: new Emitter<ConnectionEvents>(),
          connected: true,
          jid: 'me@example.net/web'
        } as unknown as ChatConnection
        connection.events.on('message', (message) => store.ingest(message, null))
        try {
          for (const op of ops) {
            const stanza = toStanza(store, op)
            if (stanza) connection.events.emit('message', stanza)
            assertInvariants(store)
          }
        } finally {
          store.dispose()
        }
      }),
      { numRuns: 30 }
    )
  })
})
