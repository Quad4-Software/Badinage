// XEP-0045 groupchat: join, part, subject change, instant-room accept.

import { $iq, $msg, $pres } from 'strophe.js'

import { NS } from '../ns'
import { noop, type XmppTransport } from './transport'

const JOIN_HISTORY_STANZAS = '100'

// self-presence status code meaning we created the room and it is locked
// until the owner accepts or submits a configuration
export const ROOM_CREATED_CODE = '201'

export function joinRoom(conn: XmppTransport, room: string, nick: string, password?: string): void {
  const x = $pres({ to: `${room}/${nick}` }).c('x', { xmlns: NS.MUC })
  if (password) x.c('password').t(password).up()
  x.c('history', { maxstanzas: JOIN_HISTORY_STANZAS })
  conn.send(x)
}

export function leaveRoom(conn: XmppTransport, room: string, nick: string): void {
  conn.send($pres({ to: `${room}/${nick}`, type: 'unavailable' }))
}

export function setRoomSubject(conn: XmppTransport, room: string, subject: string): void {
  conn.send($msg({ to: room, type: 'groupchat' }).c('subject').t(subject))
}

// XEP-0045: answer a 201 status by accepting the default room
// configuration so other occupants can join. An empty data-form submit
// takes every default.
export function acceptInstantRoom(conn: XmppTransport, room: string): void {
  conn.sendIq(
    $iq({ type: 'set', to: room })
      .c('query', { xmlns: NS.MUC_OWNER })
      .c('x', { xmlns: NS.FORMS, type: 'submit' }),
    noop
  )
}
