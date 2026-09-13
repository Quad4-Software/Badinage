// Incoming stanza dispatch: parse the stanza, emit the typed events,
// reply where the protocol requires it. Every handler returns true so
// Strophe keeps it registered.

import { $iq } from 'strophe.js'

import type { Emitter } from '$lib/core/events'

import { NS } from '../ns'
import {
  parseBlockPush,
  parseBookmark,
  parseMessage,
  parsePepEvent,
  parsePresence,
  parseRosterItems,
  type Bookmark
} from '../stanzas'
import type { ConnectionEvents } from '../types'
import { noteAvatarHash } from './avatars'
import { answerDiscoInfo, answerDiscoItems } from './disco'
import { acceptInstantRoom, ROOM_CREATED_CODE } from './muc'
import type { XmppTransport } from './transport'

export function handleMessage(stanza: Element, events: Emitter<ConnectionEvents>): boolean {
  // PEP event notifications arrive as (usually bodiless) headline
  // messages; the bookmark node fan-outs signal that another resource
  // changed our bookmarks
  const pep = parsePepEvent(stanza)
  if (pep?.node === NS.BOOKMARKS) {
    const updated = pep.items
      .map((item) => parseBookmark(item))
      .filter((b): b is Bookmark => b !== null && b.jid !== '')
    events.emit('bookmarks', { updated, retracted: pep.retracted })
  }
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
    // XEP-0153: the occupant photo hash keys the avatar cache under the
    // room/nick address the vcard is fetched from
    noteAvatarHash(
      conn,
      `${parsed.occupant.room}/${parsed.occupant.nick}`,
      parsed.occupant.avatarHash
    )
    events.emit('occupant', parsed.occupant)
  } else if (parsed.kind === 'subscribe') {
    events.emit('subscriptionRequest', { from: parsed.from, status: parsed.status })
  } else {
    noteAvatarHash(conn, parsed.presence.from, parsed.presence.avatarHash)
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

// XEP-0030: answer disco#info iq get stanzas with our identity and the
// shared feature registry. The same reply serves bare and caps
// node#ver queries.
export function handleDiscoInfoGet(stanza: Element, conn: XmppTransport): boolean {
  return answerDiscoInfo(conn, stanza)
}

// We host no components: disco#items gets an empty list back.
export function handleDiscoItemsGet(stanza: Element, conn: XmppTransport): boolean {
  return answerDiscoItems(conn, stanza)
}

function replyResult(stanza: Element, conn: XmppTransport): void {
  const from = stanza.getAttribute('from')
  const attrs: Record<string, string> = { type: 'result', id: stanza.getAttribute('id') ?? '' }
  if (from) attrs.to = from
  conn.send($iq(attrs))
}
