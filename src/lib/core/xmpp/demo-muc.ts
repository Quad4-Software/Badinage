// Demo-mode MUC behavior: canned room events that mimic what a real
// server would emit. Free functions so demo.ts stays under the size
// gate. Each takes the event emitter and the demo account jid.

import type { Emitter } from '$lib/core/events'

import type { ConnectionEvents } from './connection'
import { demoRoomConfig, ROOM_SUBJECT, roomOccupants } from './demo-data'
import type { DataForm } from './stanzas'

const DEMO_NICK_CHANGE_DELAY_MS = 300
const DEMO_ROOM_CONFIG_DELAY_MS = 400

export function demoJoinRoom(
  events: Emitter<ConnectionEvents>,
  jid: string,
  room: string,
  nick: string
): void {
  for (const occupant of roomOccupants(room, nick, jid)) {
    events.emit('occupant', occupant)
  }
  events.emit('message', {
    from: room,
    to: jid,
    body: '',
    type: 'groupchat',
    subject: ROOM_SUBJECT
  })
}

export function demoLeaveRoom(events: Emitter<ConnectionEvents>, room: string, nick: string): void {
  events.emit('occupant', {
    room,
    nick,
    presence: 'offline',
    affiliation: 'member',
    role: 'none',
    self: true,
    codes: ['110']
  })
}

// echo the subject back as a room message so the header updates
export function demoSetRoomSubject(
  events: Emitter<ConnectionEvents>,
  jid: string,
  room: string,
  subject: string
): void {
  events.emit('message', { from: room, to: jid, body: '', type: 'groupchat', subject })
}

// the real flow is unavailable-with-303 for the old nick followed by
// available presence for the new one
export function demoChangeRoomNick(
  events: Emitter<ConnectionEvents>,
  timers: ReturnType<typeof setTimeout>[],
  jid: string,
  room: string,
  oldNick: string,
  newNick: string
): void {
  events.emit('occupant', {
    room,
    nick: oldNick,
    presence: 'offline',
    affiliation: 'owner',
    role: 'none',
    self: true,
    codes: ['110', '303'],
    newNick
  })
  timers.push(
    setTimeout(() => {
      events.emit('occupant', {
        room,
        nick: newNick,
        presence: 'online',
        affiliation: 'owner',
        role: 'moderator',
        self: true,
        codes: ['110'],
        jid,
        occupantId: 'occ-self'
      })
    }, DEMO_NICK_CHANGE_DELAY_MS)
  )
}

export function demoKickOccupant(
  events: Emitter<ConnectionEvents>,
  room: string,
  nick: string,
  reason?: string
): void {
  events.emit('occupant', {
    room,
    nick,
    presence: 'offline',
    affiliation: 'member',
    role: 'none',
    self: false,
    codes: ['307'],
    reason
  })
}

export function demoBanOccupant(
  events: Emitter<ConnectionEvents>,
  room: string,
  jid: string,
  reason?: string
): void {
  // the ban iq names a jid. The room then drops the matching occupant
  const nick = jid.split('@')[0] ?? jid
  events.emit('occupant', {
    room,
    nick,
    presence: 'offline',
    affiliation: 'none',
    role: 'none',
    self: false,
    codes: ['301'],
    reason
  })
}

// the room broadcasts a retraction notice addressed at nobody
export function demoModerateMessage(
  events: Emitter<ConnectionEvents>,
  jid: string,
  room: string,
  stanzaId: string,
  reason?: string
): void {
  events.emit('message', {
    from: room,
    to: jid,
    body: '',
    type: 'groupchat',
    retraction: { id: stanzaId, reason }
  })
}

export function demoFetchRoomConfig(
  timers: ReturnType<typeof setTimeout>[],
  onDone: (form: DataForm | null) => void
): void {
  timers.push(setTimeout(() => onDone(demoRoomConfig()), DEMO_ROOM_CONFIG_DELAY_MS))
}
