// Incoming stanza dispatch: parse the stanza, emit the typed events,
// reply where the protocol requires it. Every handler returns true so
// Strophe keeps it registered.

import { $iq } from 'strophe.js'

import type { Emitter } from '$lib/core/events'

import { parseBlockPush, parseMessage, parsePresence, parseRosterItems } from '../stanzas'
import type { ConnectionEvents } from '../types'
import { acceptInstantRoom, ROOM_CREATED_CODE } from './muc'
import type { XmppTransport } from './transport'

export function handleMessage(stanza: Element, events: Emitter<ConnectionEvents>): boolean {
  const message = parseMessage(stanza)
  if (message) events.emit('message', message)
  return true
}

export function handlePresence(
  stanza: Element,
  events: Emitter<ConnectionEvents>,
  conn: XmppTransport
): boolean {
  const parsed = parsePresence(stanza)
  if (!parsed) return true
  if (parsed.kind === 'occupant') {
    // a fresh room stays locked until the owner accepts the instant-room
    // defaults; answer 201 automatically so second joiners can get in
    if (parsed.occupant.self && parsed.occupant.codes.includes(ROOM_CREATED_CODE)) {
      acceptInstantRoom(conn, parsed.occupant.room)
    }
    events.emit('occupant', parsed.occupant)
  } else if (parsed.kind === 'subscribe') {
    events.emit('subscriptionRequest', { from: parsed.from, status: parsed.status })
  } else {
    events.emit('presence', parsed.presence)
  }
  return true
}

export function handleRosterPush(
  stanza: Element,
  events: Emitter<ConnectionEvents>,
  conn: XmppTransport
): boolean {
  for (const item of parseRosterItems(stanza)) {
    if (item.subscription === 'remove') {
      events.emit('rosterRemove', item.jid)
    } else {
      events.emit('rosterUpdate', item)
    }
  }
  // roster pushes require an empty result reply
  replyResult(stanza, conn)
  return true
}

// XEP-0191: the server pushes block/unblock sets to every resource so
// all clients keep the same blocklist.
export function handleBlockPush(
  stanza: Element,
  events: Emitter<ConnectionEvents>,
  conn: XmppTransport
): boolean {
  const { blocked, unblocked } = parseBlockPush(stanza)
  if (blocked) events.emit('blocked', blocked)
  if (unblocked) events.emit('unblocked', unblocked)
  replyResult(stanza, conn)
  return true
}

function replyResult(stanza: Element, conn: XmppTransport): void {
  const from = stanza.getAttribute('from')
  const attrs: Record<string, string> = { type: 'result', id: stanza.getAttribute('id') ?? '' }
  if (from) attrs.to = from
  conn.send($iq(attrs))
}
