import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Emitter } from '$lib/core/events'
import type { ChatConnection, ConnectionEvents } from '$lib/core/xmpp/connection'
import type { IncomingMessage } from '$lib/core/xmpp/stanzas'

import { ChatStore } from './chats.svelte'
import { emptyMessage } from './conversation.svelte'

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
  vi.useRealTimers()
})

describe('ChatStore ingest', () => {
  it('stores an incoming dm and bumps the unread counter', () => {
    connection.events.emit('message', incoming({ stanzaId: 's1' }))
    const conversation = store.conversations.get('peer@example.net')
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]?.body).toBe('hello')
    expect(conversation?.messages[0]?.outgoing).toBe(false)
    expect(conversation?.unread).toBe(1)
  })

  it('resets unread when the conversation is closed', () => {
    connection.events.emit('message', incoming({ stanzaId: 's1' }))
    store.close('peer@example.net')
    expect(store.conversations.get('peer@example.net')?.unread).toBe(0)
  })

  it('routes a sent carbon to the peer as delivered outgoing mail', () => {
    connection.events.emit(
      'message',
      incoming({ from: 'me@example.net/web', to: 'peer@example.net', carbon: 'sent' })
    )
    const conversation = store.conversations.get('peer@example.net')
    expect(conversation?.unread).toBe(0)
    expect(conversation?.messages[0]?.outgoing).toBe(true)
    expect(conversation?.messages[0]?.delivered).toBe(true)
  })

  it('deduplicates on stanza id', () => {
    connection.events.emit('message', incoming({ stanzaId: 's1', id: 'w1' }))
    connection.events.emit('message', incoming({ stanzaId: 's1', id: 'w2' }))
    expect(store.conversations.get('peer@example.net')?.messages).toHaveLength(1)
  })

  it('applies a reaction stanza to the stored target', () => {
    connection.events.emit('message', incoming({ id: 'w1', stanzaId: 's1' }))
    connection.events.emit(
      'message',
      incoming({ body: '', reactionTo: { id: 'w1', emojis: ['\u{1F44D}'] } })
    )
    const conversation = store.conversations.get('peer@example.net')
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]?.reactions).toEqual({ '\u{1F44D}': ['peer@example.net'] })
  })

  it('applies a correction in place instead of appending', () => {
    connection.events.emit('message', incoming({ id: 'w1', stanzaId: 's1', body: 'typo' }))
    connection.events.emit('message', incoming({ replaceId: 'w1', body: 'fixed' }))
    const conversation = store.conversations.get('peer@example.net')
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]?.body).toBe('fixed')
    expect(conversation?.messages[0]?.edited).toBe(true)
  })

  it('marks a stored outgoing message delivered on receipt', () => {
    const sent = { ...emptyMessage('peer@example.net'), id: 'local-1', wireId: 'w1' }
    store.push('peer@example.net', sent)
    connection.events.emit('message', incoming({ body: '', receiptFor: 'w1' }))
    expect(sent.delivered).toBe(true)
    expect(store.conversations.get('peer@example.net')?.messages).toHaveLength(1)
  })

  it('reflects a composing peer then clears it when a body arrives', () => {
    connection.events.emit('message', incoming({ body: '', chatState: 'composing' }))
    const conversation = store.conversations.get('peer@example.net')
    expect(conversation?.peerState).toBe('composing')
    expect(conversation?.messages).toHaveLength(0)

    connection.events.emit('message', incoming({ stanzaId: 's2' }))
    expect(conversation?.peerState).toBe('paused')
    expect(conversation?.messages).toHaveLength(1)
  })

  it('tracks groupchat messages under the room jid with the sender nick', () => {
    connection.events.emit(
      'message',
      incoming({ from: `${ROOM}/nick1`, type: 'groupchat', stanzaId: 's1', nick: 'nick1' })
    )
    const conversation = store.conversations.get(ROOM)
    expect(conversation?.kind).toBe('muc')
    expect(conversation?.messages[0]?.nick).toBe('nick1')
    expect(conversation?.messages[0]?.outgoing).toBe(false)
  })

  it('merges a muc self-echo into the locally sent copy', () => {
    store.setOccupant(ROOM, {
      nick: 'me',
      presence: 'chat',
      affiliation: 'member',
      role: 'participant',
      self: true
    })
    const local = { ...emptyMessage(ROOM), id: 'local-1', body: 'yo' }
    store.push(ROOM, local)

    connection.events.emit(
      'message',
      incoming({
        from: `${ROOM}/me`,
        to: 'me@example.net/web',
        type: 'groupchat',
        body: 'yo',
        stanzaId: 'srv-1',
        nick: 'me'
      })
    )

    const conversation = store.conversations.get(ROOM)
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages[0]?.delivered).toBe(true)
    expect(conversation?.messages[0]?.id).toBe('srv-1')
  })
})
