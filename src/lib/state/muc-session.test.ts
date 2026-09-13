import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROOM_REJOIN_DELAY_MS, ROOM_REJOIN_MAX_ATTEMPTS } from '$lib/constants'
import { Emitter } from '$lib/core/events'
import type { ChatConnection, ConnectionEvents } from '$lib/core/xmpp/connection'
import type { MucOccupant } from '$lib/core/xmpp/stanzas'

import { ChatStore } from './chats.svelte'
import { RoomSessions } from './muc-session'

// same seam as chats.test.ts: persistence goes through a mocked idb
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
const ROOM = 'room@conference.example.net'

function fakeConnection(): ChatConnection & { joins: { room: string; nick: string }[] } {
  const joins: { room: string; nick: string }[] = []
  return {
    events: new Emitter<ConnectionEvents>(),
    connected: true,
    jid: 'me@example.net/web',
    joins,
    joinRoom(room: string, nick: string) {
      joins.push({ room, nick })
    },
    pingOccupant(_room: string, _nick: string, onDone: (alive: boolean) => void) {
      onDone(true)
    }
  } as unknown as ChatConnection & { joins: { room: string; nick: string }[] }
}

function occupant(overrides: Partial<MucOccupant> = {}): MucOccupant {
  return {
    room: ROOM,
    nick: 'me',
    presence: 'online',
    affiliation: 'member',
    role: 'participant',
    self: true,
    codes: ['110'],
    ...overrides
  }
}

let store: ChatStore
let connection: ReturnType<typeof fakeConnection>
let sessions: RoomSessions

beforeEach(() => {
  vi.useFakeTimers()
  store = new ChatStore(ACCOUNT)
  connection = fakeConnection()
  sessions = new RoomSessions(connection, store)
  store.noteJoin(ROOM, 'me', 'pw')
  sessions.noteOccupant(occupant())
  store.setOccupant(ROOM, occupant())
})

afterEach(() => {
  sessions.dispose()
  vi.useRealTimers()
})

describe('RoomSessions', () => {
  it('rejoins once after a kick and reports success on self presence', () => {
    sessions.noteOccupant(occupant({ presence: 'offline', codes: ['110', '307'] }))
    store.setOccupant(ROOM, occupant({ presence: 'offline', codes: ['110', '307'] }))
    vi.advanceTimersByTime(ROOM_REJOIN_DELAY_MS)
    expect(connection.joins).toEqual([{ room: ROOM, nick: 'me' }])
    // the rejoin landing clears the retry budget
    sessions.noteOccupant(occupant())
    sessions.noteOccupant(occupant({ presence: 'offline', codes: ['110', '307'] }))
    vi.advanceTimersByTime(ROOM_REJOIN_DELAY_MS * 10)
    expect(connection.joins).toHaveLength(2)
  })

  it('never rejoins after a ban', () => {
    sessions.noteOccupant(occupant({ presence: 'offline', codes: ['110', '301'] }))
    vi.advanceTimersByTime(ROOM_REJOIN_DELAY_MS * 10)
    expect(connection.joins).toHaveLength(0)
  })

  it('bounds rejoin attempts so a failing room does not loop', () => {
    for (let i = 0; i < ROOM_REJOIN_MAX_ATTEMPTS + 2; i++) {
      sessions.noteOccupant(occupant({ presence: 'offline', codes: ['110', '307'] }))
      vi.advanceTimersByTime(ROOM_REJOIN_DELAY_MS * 2 ** i + 1)
    }
    expect(connection.joins.length).toBeLessThanOrEqual(ROOM_REJOIN_MAX_ATTEMPTS)
  })

  it('cancels a pending rejoin when a join error arrives', () => {
    sessions.noteOccupant(occupant({ presence: 'offline', codes: ['110', '307'] }))
    sessions.noteJoinError({ from: `${ROOM}/me`, code: '409', condition: 'conflict' })
    vi.advanceTimersByTime(ROOM_REJOIN_DELAY_MS * 10)
    expect(connection.joins).toHaveLength(0)
    expect(store.conversations.get(ROOM)?.joinError?.code).toBe('409')
  })

  it('rejoins every still-joined room on reconnect', () => {
    sessions.noteStatus('disconnected')
    sessions.noteStatus('connected')
    expect(connection.joins).toEqual([{ room: ROOM, nick: 'me' }])
  })

  it('does not rejoin a room we left manually', () => {
    sessions.noteOccupant(occupant({ presence: 'offline', codes: ['110'] }))
    store.setOccupant(ROOM, occupant({ presence: 'offline', codes: ['110'] }))
    sessions.noteStatus('disconnected')
    sessions.noteStatus('connected')
    expect(connection.joins).toHaveLength(0)
  })

  it('treats the offline half of a rename as a rename, not a departure', () => {
    sessions.noteOccupant(occupant({ presence: 'offline', codes: ['110', '303'], newNick: 'me2' }))
    vi.advanceTimersByTime(ROOM_REJOIN_DELAY_MS * 10)
    expect(connection.joins).toHaveLength(0)
  })
})
