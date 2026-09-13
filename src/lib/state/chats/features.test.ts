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

// The app wires store.ingest to the message event of whatever implements
// ChatConnection; a bare Emitter covers that seam without strophe.
function fakeConnection(): ChatConnection {
  return {
    events: new Emitter<ConnectionEvents>(),
    connected: true,
    jid: 'me@example.net/web'
  } as unknown as ChatConnection
}

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    from: 'peer@example.net/phone',
    to: 'me@example.net/web',
    body: 'hello',
    type: 'chat',
    ...overrides
  }
}

const ACCOUNT = 'me@example.net'
const ROOM = 'room@conference.example.net'

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

function selfOccupant2(nick = 'me') {
  return {
    nick,
    presence: 'online',
    affiliation: 'member',
    role: 'participant',
    self: true,
    codes: ['110']
  }
}

function roomMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    from: `${ROOM}/them`,
    to: 'me@example.net/web',
    body: 'hi room',
    type: 'groupchat',
    nick: 'them',
    ...overrides
  }
}

describe('ChatStore MDS', () => {
  it('ignores a displayed marker for a stanza-id we never received', () => {
    connection.events.emit('message', incoming({ stanzaId: 's1', delay: 1000 }))
    connection.events.emit('message', incoming({ stanzaId: 's2', delay: 2000 }))
    const conv = store.open('peer@example.net')
    conv.unread = 2
    store.markDisplayedRemote('peer@example.net', 'unknown-stanza')
    expect(conv.messages.every((m) => !m.read)).toBe(true)
    expect(conv.unread).toBe(2)
  })

  it('marks only messages up to the matched stanza-id', () => {
    connection.events.emit('message', incoming({ stanzaId: 's1', delay: 1000 }))
    connection.events.emit('message', incoming({ stanzaId: 's2', delay: 2000 }))
    const conv = store.open('peer@example.net')
    conv.unread = 2
    store.markDisplayedRemote('peer@example.net', 's1')
    expect(conv.messages[0]?.read).toBe(true)
    expect(conv.messages[1]?.read).toBe(false)
    expect(conv.unread).toBe(1)
  })
})

describe('ChatStore ephemeral', () => {
  it('adopts the stanza timer and stamps expiresAt on the row', () => {
    const now = Date.now()
    connection.events.emit('message', incoming({ ephemeralTimer: 60, stanzaId: 's1' }))
    const conv = store.open('peer@example.net')
    expect(conv.ephemeralTimer).toBe(60)
    const m = conv.messages.at(-1)
    expect(m?.expiresAt).toBeGreaterThan(now + 50_000)
    expect(m?.expiresAt).toBeLessThanOrEqual(now + 61_000)
  })

  it('applies the negotiated timer when the stanza carries none', () => {
    connection.events.emit('message', incoming({ ephemeralTimer: 300, stanzaId: 's1' }))
    connection.events.emit('message', incoming({ stanzaId: 's2', body: 'no timer here' }))
    const conv = store.open('peer@example.net')
    expect(conv.messages.at(-1)?.expiresAt).toBeDefined()
  })

  it('a peer-sent timer of 0 disables the mode and stops stamping rows', () => {
    connection.events.emit('message', incoming({ ephemeralTimer: 60, stanzaId: 's1' }))
    connection.events.emit('message', incoming({ ephemeralTimer: 0, stanzaId: 's2' }))
    const conv = store.open('peer@example.net')
    expect(conv.ephemeralTimer).toBeUndefined()
    connection.events.emit('message', incoming({ stanzaId: 's3', body: 'plain' }))
    expect(conv.messages.at(-1)?.expiresAt).toBeUndefined()
  })

  it('the sweep removes expired rows and recomputes unread', () => {
    connection.events.emit('message', incoming({ ephemeralTimer: 1, stanzaId: 's1' }))
    const conv = store.open('peer@example.net')
    conv.unread = 1
    vi.advanceTimersByTime(60_000)
    expect(conv.messages).toHaveLength(0)
    expect(conv.unread).toBe(0)
  })

  it('a gigantic stanza timer does not overflow into the past', () => {
    connection.events.emit('message', incoming({ ephemeralTimer: 2147483647, stanzaId: 's1' }))
    const m = store.open('peer@example.net').messages.at(-1)
    expect(m?.expiresAt).toBeGreaterThan(Date.now())
    expect(Number.isFinite(m?.expiresAt)).toBe(true)
  })
})

describe('ChatStore rtt', () => {
  it('applies ops into a live buffer and clears it when the body lands', () => {
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 0, event: 'new', ops: [{ type: 't', text: 'he' }] } })
    )
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 1, event: 'edit', ops: [{ type: 't', text: 'llo' }] } })
    )
    const conv = store.open('peer@example.net')
    expect(conv.liveText.get('')?.text).toBe('hello')
    connection.events.emit('message', incoming({ body: 'hello', stanzaId: 's9' }))
    expect(conv.liveText.size).toBe(0)
  })

  it('a cancel event drops the buffer', () => {
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 0, event: 'new', ops: [{ type: 't', text: 'wip' }] } })
    )
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 1, event: 'cancel', ops: [] } })
    )
    expect(store.open('peer@example.net').liveText.size).toBe(0)
  })

  it('stale buffers expire after the rtt ttl', () => {
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 0, event: 'new', ops: [{ type: 't', text: 'x' }] } })
    )
    vi.advanceTimersByTime(60_000)
    expect(store.open('peer@example.net').liveText.size).toBe(0)
  })

  it('never renders rtt buffers as message rows', () => {
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 0, event: 'new', ops: [{ type: 't', text: 'x' }] } })
    )
    expect(store.open('peer@example.net').messages).toHaveLength(0)
  })
})

describe('ChatStore attention', () => {
  it('flags the conversation and notifies without a message row', () => {
    let live: IncomingMessage | undefined
    store.onLive = (_peer, message) => {
      live = message
    }
    connection.events.emit('message', incoming({ body: '', attention: true }))
    const conv = store.open('peer@example.net')
    expect(conv.attentionAt).toBeDefined()
    expect(conv.messages).toHaveLength(0)
    expect(live?.attention).toBe(true)
  })
})

describe('ChatStore mentions', () => {
  it('flags a mention reference whose range covers our nick', () => {
    store.noteJoin(ROOM, 'me')
    store.setOccupant(ROOM, selfOccupant2())
    connection.events.emit(
      'message',
      roomMsg({
        body: 'hey @me ping',
        references: [{ type: 'mention', begin: 4, end: 7 }],
        stanzaId: 's1'
      })
    )
    const conv = store.open(ROOM)
    expect(conv.messages.at(-1)?.mentionsMe).toBe(true)
  })

  it('flags a bare nick mention without references', () => {
    store.noteJoin(ROOM, 'me')
    store.setOccupant(ROOM, selfOccupant2())
    connection.events.emit('message', roomMsg({ body: 'me: look at this', stanzaId: 's1' }))
    expect(store.open(ROOM).messages.at(-1)?.mentionsMe).toBe(true)
  })

  it('does not flag nick substrings inside words', () => {
    store.noteJoin(ROOM, 'me')
    store.setOccupant(ROOM, selfOccupant2())
    connection.events.emit('message', roomMsg({ body: 'memory lane media', stanzaId: 's1' }))
    expect(store.open(ROOM).messages.at(-1)?.mentionsMe).toBeUndefined()
  })

  it('survives out-of-range reference positions and regex-hostile nicks', () => {
    store.noteJoin(ROOM, 'me.()')
    store.setOccupant(ROOM, selfOccupant2('me.()'))
    connection.events.emit(
      'message',
      roomMsg({
        body: 'hello there me.() ok',
        references: [{ type: 'mention', begin: 999, end: 99999 }],
        stanzaId: 's1'
      })
    )
    const conv = store.open(ROOM)
    // the out-of-range reference must not match, but the bare nick still does
    expect(conv.messages.at(-1)?.mentionsMe).toBe(true)
  })

  it('does not flag our own messages', () => {
    store.noteJoin(ROOM, 'me')
    store.setOccupant(ROOM, selfOccupant2())
    connection.events.emit(
      'message',
      roomMsg({ from: `${ROOM}/me`, nick: 'me', body: '@me talking to myself', stanzaId: 's1' })
    )
    // self-echo merge applies, but mentionsMe must never be set on our rows
    const conv = store.open(ROOM)
    expect(conv.messages.at(-1)?.mentionsMe).toBeUndefined()
  })
})
