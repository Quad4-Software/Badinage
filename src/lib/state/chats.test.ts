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
// ChatConnection. A bare Emitter covers that seam without strophe.
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

  it('deduplicates a live message against its MAM copy', () => {
    // live delivery carries origin-id but no stanza-id. The archived copy
    // adds the archive stanza-id. The two copies must land once.
    connection.events.emit('message', incoming({ id: 'w1', originId: 'o1' }))
    connection.events.emit(
      'message',
      incoming({ id: 'w1', stanzaId: 'srv-1', originId: 'o1', delay: 1000 })
    )
    expect(store.conversations.get('peer@example.net')?.messages).toHaveLength(1)
  })

  it('deduplicates a locally sent message against its sent MAM copy', () => {
    const sent = { ...emptyMessage('peer@example.net'), id: 'w1', outgoing: true }
    store.push('peer@example.net', sent)
    connection.events.emit(
      'message',
      incoming({
        from: 'me@example.net/web',
        to: 'peer@example.net',
        carbon: 'sent',
        id: 'w1',
        stanzaId: 'srv-1',
        originId: 'o1'
      })
    )
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

  it('flags an outgoing message failed on a type=error bounce', () => {
    const sent = { ...emptyMessage('peer@example.net'), id: 'local-1', wireId: 'w1' }
    store.push('peer@example.net', sent)
    connection.events.emit(
      'message',
      incoming({
        type: 'chat',
        id: 'w1',
        body: 'echoed',
        error: { condition: 'service-unavailable', text: 'user gone' }
      })
    )
    const conversation = store.conversations.get('peer@example.net')
    expect(sent.deliveryError).toBe('service-unavailable')
    // the bounced stanza never becomes a second row
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.unread).toBe(0)
  })

  it('ignores a type=error bounce for a message we never sent', () => {
    connection.events.emit(
      'message',
      incoming({ id: 'unknown', body: 'echoed', error: { condition: 'gone' } })
    )
    const conversation = store.conversations.get('peer@example.net')
    expect(conversation?.messages ?? []).toHaveLength(0)
  })

  it('wipes local history without touching the archive', () => {
    connection.events.emit('message', incoming({ stanzaId: 's1' }))
    connection.events.emit('message', incoming({ stanzaId: 's2' }))
    const conversation = store.conversations.get('peer@example.net')
    expect(conversation?.messages).toHaveLength(2)
    store.clearHistory('peer@example.net')
    expect(conversation?.messages).toHaveLength(0)
    expect(conversation?.unread).toBe(0)
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

  it('tombstones a message when its author retracts it', () => {
    connection.events.emit('message', incoming({ id: 'w1', stanzaId: 's1', body: 'oops' }))
    connection.events.emit('message', incoming({ body: '', retractId: 'w1' }))
    const messages = store.conversations.get('peer@example.net')?.messages
    expect(messages).toHaveLength(1)
    expect(messages?.[0]?.retracted).toBe(true)
    expect(messages?.[0]?.body).toBe('')
  })

  it('clears reactions when a message is retracted', () => {
    connection.events.emit('message', incoming({ id: 'w1', stanzaId: 's1' }))
    connection.events.emit(
      'message',
      incoming({ body: '', reactionTo: { id: 'w1', emojis: ['\u{1F44D}'] } })
    )
    connection.events.emit('message', incoming({ body: '', retractId: 'w1' }))
    const target = store.conversations.get('peer@example.net')?.messages[0]
    expect(target?.retracted).toBe(true)
    expect(target?.reactions).toEqual({})
  })

  it('never stores the retraction fallback body, even for unknown targets', () => {
    connection.events.emit(
      'message',
      incoming({ retractId: 'no-such-message', body: '/me retracted a message' })
    )
    expect(store.conversations.get('peer@example.net')?.messages ?? []).toHaveLength(0)
  })

  it('does not let a peer retract our outgoing message', () => {
    const sent = { ...emptyMessage('peer@example.net'), id: 'local-1', wireId: 'w1' }
    store.push('peer@example.net', sent)
    connection.events.emit('message', incoming({ body: '', retractId: 'w1' }))
    expect(sent.retracted).toBeUndefined()
  })

  it('retracts our own message when the retraction arrives as a sent carbon', () => {
    connection.events.emit(
      'message',
      incoming({ from: 'me@example.net/phone', to: 'peer@example.net', carbon: 'sent', id: 'w1' })
    )
    connection.events.emit(
      'message',
      incoming({
        from: 'me@example.net/phone',
        to: 'peer@example.net',
        carbon: 'sent',
        body: '',
        retractId: 'w1'
      })
    )
    const messages = store.conversations.get('peer@example.net')?.messages
    expect(messages).toHaveLength(1)
    expect(messages?.[0]?.retracted).toBe(true)
  })

  it('honours a muc retraction only from the same nick', () => {
    connection.events.emit(
      'message',
      incoming({ from: `${ROOM}/nick1`, type: 'groupchat', stanzaId: 's1', nick: 'nick1' })
    )
    connection.events.emit(
      'message',
      incoming({
        from: `${ROOM}/nick2`,
        type: 'groupchat',
        nick: 'nick2',
        body: '',
        retractId: 's1'
      })
    )
    const target = store.conversations.get(ROOM)?.messages[0]
    expect(target?.retracted).toBeUndefined()

    connection.events.emit(
      'message',
      incoming({
        from: `${ROOM}/nick1`,
        type: 'groupchat',
        nick: 'nick1',
        body: '',
        retractId: 's1'
      })
    )
    expect(target?.retracted).toBe(true)
  })

  it('marks the stored message on a MAM tombstone', () => {
    connection.events.emit('message', incoming({ id: 'w1', stanzaId: 's1', body: 'later gone' }))
    connection.events.emit(
      'message',
      incoming({ stanzaId: 's1', body: '', retracted: {}, mam: true, delay: 2000 })
    )
    const messages = store.conversations.get('peer@example.net')?.messages
    expect(messages).toHaveLength(1)
    expect(messages?.[0]?.retracted).toBe(true)
    expect(messages?.[0]?.body).toBe('')
  })

  it('stores the spoiler hint and the unstyled flag', () => {
    connection.events.emit(
      'message',
      incoming({ body: 'the butler did it', spoilerHint: 'ending', stanzaId: 's9' })
    )
    const target = store.conversations.get('peer@example.net')?.messages[0]
    expect(target?.spoilerHint).toBe('ending')

    connection.events.emit('message', incoming({ body: 'plain', unstyled: true, stanzaId: 's10' }))
    expect(store.conversations.get('peer@example.net')?.messages[1]?.unstyled).toBe(true)
  })

  it('lets a correction update the spoiler state of its target', () => {
    connection.events.emit(
      'message',
      incoming({ id: 'w1', stanzaId: 's1', body: 'hidden', spoilerHint: 'h' })
    )
    connection.events.emit('message', incoming({ replaceId: 'w1', body: 'now plain' }))
    const target = store.conversations.get('peer@example.net')?.messages[0]
    expect(target?.body).toBe('now plain')
    expect(target?.spoilerHint).toBeUndefined()
  })

  it('merges a muc self-echo into the locally sent copy', () => {
    store.setOccupant(ROOM, {
      nick: 'me',
      presence: 'chat',
      affiliation: 'member',
      role: 'participant',
      self: true,
      codes: ['110']
    })
    // locally pushed room messages carry the nick they were sent under
    const local = { ...emptyMessage(ROOM), id: 'local-1', body: 'yo', nick: 'me' }
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
