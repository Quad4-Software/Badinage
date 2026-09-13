// XEP-0045 groupchat: join, part, nick change, subject, invites,
// moderation (kick/ban plus XEP-0425 retraction), owner configuration
// and the XEP-0199 self-ping used to detect ghost joins.

import { $iq, $msg, $pres } from 'strophe.js'

import { bareJid } from '$lib/utils/jid'
import { childElements } from '$lib/utils/xml'

import { NS } from '../ns'
import { parseDataForm, type DataForm } from '../stanzas'
import { appendSubmitForm } from './dataforms'
import { noop, type XmppTransport } from './transport'

const JOIN_HISTORY_STANZAS = '100'

// self-presence status code meaning we created the room and it is locked
// until the owner accepts or submits a configuration
export const ROOM_CREATED_CODE = '201'

// status codes on self-presence unavailable stanzas that decide the
// rejoin behavior: 301 banned, 303 nick change, 307 kicked
export const SELF_BANNED_CODE = '301'
export const SELF_RENAMED_CODE = '303'
export const SELF_KICKED_CODE = '307'

export function joinRoom(conn: XmppTransport, room: string, nick: string, password?: string): void {
  const x = $pres({ to: `${room}/${nick}` }).c('x', { xmlns: NS.MUC })
  if (password) x.c('password').t(password).up()
  x.c('history', { maxstanzas: JOIN_HISTORY_STANZAS })
  conn.send(x)
}

export function leaveRoom(conn: XmppTransport, room: string, nick: string): void {
  conn.send($pres({ to: `${room}/${nick}`, type: 'unavailable' }))
}

// In-room nick change: the classic dance is an unavailable presence to
// the old nick followed by a fresh join to the new one, which works on
// every server including those that reject direct renames.
export function changeRoomNick(
  conn: XmppTransport,
  room: string,
  oldNick: string,
  newNick: string,
  password?: string
): void {
  leaveRoom(conn, room, oldNick)
  joinRoom(conn, room, newNick, password)
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

// XEP-0249 direct invite: message to the invitee carrying the room jid
// and the password so password-protected rooms stay joinable.
function sendDirectInvite(
  conn: XmppTransport,
  room: string,
  to: string,
  reason?: string,
  password?: string
): void {
  const attrs: Record<string, string> = { xmlns: NS.DIRECT_INVITE, jid: room }
  if (reason) attrs.reason = reason
  if (password) attrs.password = password
  conn.send($msg({ to: bareJid(to) }).c('x', attrs))
}

// XEP-0045 mediated invite: the room relays it to the invitee, which is
// what grants access in members-only rooms when we have the rights.
function sendMediatedInvite(conn: XmppTransport, room: string, to: string, reason?: string): void {
  const invite = $msg({ to: room })
    .c('x', { xmlns: NS.MUC_USER })
    .c('invite', { to: bareJid(to) })
  if (reason) invite.c('reason').t(reason)
  conn.send(invite)
}

// Outgoing invite: send both a direct invite to the invitee and a
// mediated one through the room. Without a disco probe there is no way
// to know which the room and the invitee's client support, and the
// mediated path is what grants entry to members-only rooms when the
// inviter has the rights.
export function inviteToRoom(
  conn: XmppTransport,
  room: string,
  to: string,
  opts?: { reason?: string; password?: string }
): void {
  sendDirectInvite(conn, room, to, opts?.reason, opts?.password)
  sendMediatedInvite(conn, room, to, opts?.reason)
}

// XEP-0045: declining an invite is always mediated; even a direct
// XEP-0249 invite is declined by telling the room.
export function sendRoomDecline(
  conn: XmppTransport,
  room: string,
  to: string,
  reason?: string
): void {
  const decline = $msg({ to: room }).c('x', { xmlns: NS.MUC_USER }).c('decline', { to })
  if (reason) decline.c('reason').t(reason)
  conn.send(decline)
}

// XEP-0045 kick: setting the role to none removes the occupant.
export function kickOccupant(
  conn: XmppTransport,
  room: string,
  nick: string,
  reason?: string
): void {
  const item = $iq({ type: 'set', to: room })
    .c('query', { xmlns: NS.MUC_ADMIN })
    .c('item', { nick, role: 'none' })
  if (reason) item.c('reason').t(reason)
  conn.sendIq(item, noop)
}

// XEP-0045 ban: outcast affiliation needs the real jid, so it is only
// offered in non-anonymous rooms.
export function banOccupant(conn: XmppTransport, room: string, jid: string, reason?: string): void {
  const item = $iq({ type: 'set', to: room })
    .c('query', { xmlns: NS.MUC_ADMIN })
    .c('item', { jid: bareJid(jid), affiliation: 'outcast' })
  if (reason) item.c('reason').t(reason)
  conn.sendIq(item, noop)
}

// XEP-0425: ask the room to retract the message carrying stanzaId. The
// current protocol version sends a bare moderate element inside an iq;
// the fasten apply-to wrapper from earlier drafts was dropped.
export function moderateMessage(
  conn: XmppTransport,
  room: string,
  stanzaId: string,
  reason?: string
): void {
  const moderate = $iq({ type: 'set', to: room }).c('moderate', {
    xmlns: NS.MESSAGE_MODERATE,
    id: stanzaId
  })
  moderate.c('retract', { xmlns: NS.MESSAGE_RETRACT }).up()
  if (reason) moderate.c('reason').t(reason)
  conn.sendIq(moderate, noop)
}

// XEP-0199 self-ping: iq to our own occupant jid. The room routes it
// back to us and our ping handler answers it, so any response means we
// are still joined. Errors saying the occupant does not exist mean the
// room dropped us silently.
export function pingOccupant(
  conn: XmppTransport,
  room: string,
  nick: string,
  onDone: (alive: boolean) => void
): void {
  conn.sendIq(
    $iq({ type: 'get', to: `${room}/${nick}`, id: conn.uniqueId('ping') }).c('ping', {
      xmlns: NS.PING
    }),
    () => onDone(true),
    (stanza) => {
      // a timeout means the stream is unhealthy; an error naming a
      // missing occupant means we were dropped from the room
      if (!stanza) {
        onDone(false)
        return
      }
      const dead = [
        'item-not-found',
        'recipient-unavailable',
        'remote-server-not-found',
        'service-unavailable'
      ]
      const error = stanza.getElementsByTagName('error').item(0) as Element | null
      const lost =
        error !== null &&
        childElements(error).some(
          (child) => child.localName !== 'text' && dead.includes(child.localName ?? '')
        )
      onDone(!lost)
    }
  )
}

// XEP-0045 owner flow: fetch the configuration form, then submit it.
export function fetchRoomConfig(
  conn: XmppTransport,
  room: string,
  onDone: (form: DataForm | null) => void
): void {
  conn.sendIq(
    $iq({ type: 'get', to: room }).c('query', { xmlns: NS.MUC_OWNER }),
    (stanza) => onDone(parseDataForm(stanza)),
    () => onDone(null)
  )
}

export function submitRoomConfig(conn: XmppTransport, room: string, form: DataForm): void {
  const query = $iq({ type: 'set', to: room }).c('query', { xmlns: NS.MUC_OWNER })
  appendSubmitForm(query, form)
  conn.sendIq(query, noop)
}
