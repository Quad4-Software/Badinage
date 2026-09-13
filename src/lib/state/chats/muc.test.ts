import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Emitter } from '$lib/core/events'
import type { ChatConnection, ConnectionEvents } from '$lib/core/xmpp/connection'
import type { IncomingMessage } from '$lib/core/xmpp/stanzas'

import { ChatStore } from '../chats.svelte'
import { emptyMessage } from '../conversation.svelte'

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

function roomMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return incoming({
    from: `${ROOM}/nick1`,
    type: 'groupchat',
    nick: 'nick1',
    stanzaId: 'rm-1',
    ...overrides
  })
}

function selfOccupant(nick = 'me', codes: string[] = ['110']) {
  return {
    nick,
    presence: 'online',
    affiliation: 'member',
    role: 'participant',
    self: true,
    codes
  }
}

describe('ChatStore muc', () => {
  it('records join parameters and clears previous failure state', () => {
    const conversation = store.open(ROOM, 'muc')
    conversation.joinError = { code: '409' }
    conversation.kicked = true
    store.noteJoin(ROOM, 'me', 's3cret')
    expect(conversation.ourNick).toBe('me')
    expect(conversation.password).toBe('s3cret')
    expect(conversation.joinError).toBeUndefined()
    expect(conversation.kicked).toBe(false)
    expect(conversation.banned).toBe(false)
  })

  it('marks the room joined on self presence and stores the occupant id', () => {
    store.setOccupant(ROOM, { ...selfOccupant(), occupantId: 'occ-me' })
    const conversation = store.conversations.get(ROOM)
    expect(conversation?.joined).toBe(true)
    expect(conversation?.ourNick).toBe('me')
    expect(conversation?.ourOccupantId).toBe('occ-me')
  })

  it('adopts the new nick from a 303 broadcast before the rejoin lands', () => {
    store.setOccupant(ROOM, selfOccupant())
    store.setOccupant(ROOM, {
      ...selfOccupant(),
      presence: 'offline',
      codes: ['110', '303'],
      newNick: 'me2'
    })
    const conversation = store.conversations.get(ROOM)
    expect(conversation?.ourNick).toBe('me2')
    expect(conversation?.ourNicks.has('me')).toBe(true)
    expect(conversation?.ourNicks.has('me2')).toBe(true)
  })

  it('flags a kick but not a ban, and a plain leave clears joined', () => {
    store.setOccupant(ROOM, selfOccupant())
    store.setOccupant(ROOM, {
      ...selfOccupant(),
      presence: 'offline',
      codes: ['110', '307'],
      reason: 'flooding'
    })
    const conversation = store.conversations.get(ROOM)
    expect(conversation?.kicked).toBe(true)
    expect(conversation?.kickReason).toBe('flooding')
    expect(conversation?.banned).toBe(false)
    expect(conversation?.joined).toBe(false)
  })

  it('flags a ban so the ui never offers auto-rejoin', () => {
    store.setOccupant(ROOM, selfOccupant())
    store.setOccupant(ROOM, {
      ...selfOccupant(),
      presence: 'offline',
      codes: ['110', '301']
    })
    const conversation = store.conversations.get(ROOM)
    expect(conversation?.banned).toBe(true)
    expect(conversation?.kicked).toBe(false)
  })

  it('adds and removes other occupants', () => {
    store.setOccupant(ROOM, {
      nick: 'nick1',
      presence: 'online',
      affiliation: 'member',
      role: 'participant',
      self: false,
      codes: []
    })
    expect(store.conversations.get(ROOM)?.occupants.has('nick1')).toBe(true)
    store.setOccupant(ROOM, {
      nick: 'nick1',
      presence: 'offline',
      affiliation: 'member',
      role: 'none',
      self: false,
      codes: []
    })
    expect(store.conversations.get(ROOM)?.occupants.has('nick1')).toBe(false)
  })

  it('keys room reactions by occupant id when one is present', () => {
    connection.events.emit('message', roomMessage({ stanzaId: 'rm-1' }))
    connection.events.emit(
      'message',
      roomMessage({
        body: '',
        stanzaId: 'rm-2',
        occupantId: 'occ-1',
        reactionTo: { id: 'rm-1', emojis: ['\u{1F44D}'] }
      })
    )
    const target = store.conversations.get(ROOM)?.messages[0]
    expect(target?.reactions).toEqual({ '\u{1F44D}': ['occ-1'] })
  })

  it('falls back to the nick as reaction key without an occupant id', () => {
    connection.events.emit('message', roomMessage({ stanzaId: 'rm-1' }))
    connection.events.emit(
      'message',
      roomMessage({
        body: '',
        stanzaId: 'rm-2',
        reactionTo: { id: 'rm-1', emojis: ['\u{1F44D}'] }
      })
    )
    const target = store.conversations.get(ROOM)?.messages[0]
    expect(target?.reactions).toEqual({ '\u{1F44D}': ['nick1'] })
  })

  it('tombstones a message on a room moderation notice', () => {
    connection.events.emit('message', roomMessage({ stanzaId: 'rm-1', body: 'spam' }))
    connection.events.emit(
      'message',
      incoming({
        from: ROOM,
        type: 'groupchat',
        body: '',
        retraction: { id: 'rm-1', reason: 'spam' }
      })
    )
    const conversation = store.conversations.get(ROOM)
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]?.retracted).toBe(true)
    expect(conversation?.messages[0]?.retractReason).toBe('spam')
    expect(conversation?.messages[0]?.body).toBe('')
  })

  it('merges a self-echo sent under a nick we no longer hold', () => {
    store.noteJoin(ROOM, 'me')
    store.setOccupant(ROOM, selfOccupant())
    const local = { ...emptyMessage(ROOM), id: 'l1', body: 'yo', nick: 'me' }
    store.push(ROOM, local)
    // rename: old nick departs, new nick arrives
    store.setOccupant(ROOM, {
      ...selfOccupant(),
      presence: 'offline',
      codes: ['110', '303'],
      newNick: 'me2'
    })
    store.setOccupant(ROOM, selfOccupant('me2'))
    // the echo of the pre-rename send still merges
    connection.events.emit(
      'message',
      roomMessage({ from: `${ROOM}/me`, nick: 'me', body: 'yo', stanzaId: 'srv-9' })
    )
    const conversation = store.conversations.get(ROOM)
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]?.delivered).toBe(true)
    expect(conversation?.messages[0]?.id).toBe('srv-9')
  })

  it('does not merge an echo whose nick never matched the send', () => {
    store.noteJoin(ROOM, 'me')
    store.setOccupant(ROOM, selfOccupant())
    const local = { ...emptyMessage(ROOM), id: 'l1', body: 'yo', nick: 'me' }
    store.push(ROOM, local)
    connection.events.emit(
      'message',
      roomMessage({ from: `${ROOM}/me2`, nick: 'me2', body: 'yo', stanzaId: 'srv-9' })
    )
    expect(store.conversations.get(ROOM)?.messages).toHaveLength(2)
  })
})

// ---- adversarial coverage for the 0490/0466/0301/0224/0372 work ----

describe('ChatStore peer resource tracking', () => {
  it('records the full jid of the last incoming stanza for feature probes', () => {
    connection.events.emit('message', incoming({ from: 'peer@example.net/phone' }))
    expect(store.open('peer@example.net').peerFullJid).toBe('peer@example.net/phone')
    connection.events.emit('message', incoming({ from: 'peer@example.net/laptop' }))
    expect(store.open('peer@example.net').peerFullJid).toBe('peer@example.net/laptop')
  })
})

describe('ChatStore rtt ordering', () => {
  it('drops an out-of-order edit but keeps a later one', () => {
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 5, event: 'new', ops: [{ type: 't', text: 'hello' }] } })
    )
    // an older seq arrives late; it must not corrupt the buffer
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 3, event: 'edit', ops: [{ type: 'e' }] } })
    )
    expect(store.open('peer@example.net').liveText.get('')?.text).toBe('hello')
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 6, event: 'edit', ops: [{ type: 't', text: '!' }] } })
    )
    expect(store.open('peer@example.net').liveText.get('')?.text).toBe('hello!')
  })

  it('a reset restarts the sequence window', () => {
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 9, event: 'new', ops: [{ type: 't', text: 'old' }] } })
    )
    connection.events.emit(
      'message',
      incoming({ body: '', rtt: { seq: 1, event: 'reset', ops: [{ type: 't', text: 'fresh' }] } })
    )
    expect(store.open('peer@example.net').liveText.get('')?.text).toBe('fresh')
  })
})
