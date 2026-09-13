// RFC 6121 roster: fetch, set, remove. fetchRoster reports through a
// callback so the connection can emit its roster event.

import { $iq } from 'strophe.js'

import { NS } from '../ns'
import { parseRosterItems, type RosterItem } from '../stanzas'
import { noop, type XmppTransport } from './transport'

export function fetchRoster(conn: XmppTransport, onDone: (items: RosterItem[]) => void): void {
  conn.sendIq(
    $iq({ type: 'get', id: conn.uniqueId('roster') }).c('query', { xmlns: NS.ROSTER }),
    (stanza) => onDone(parseRosterItems(stanza))
  )
}

export function rosterSet(
  conn: XmppTransport,
  jid: string,
  name: string,
  groups: string[] = []
): void {
  const item = $iq({ type: 'set', id: conn.uniqueId('roster-set') })
    .c('query', { xmlns: NS.ROSTER })
    .c('item', { jid })
  if (name) item.attrs({ name })
  for (const group of groups) item.c('group').t(group).up()
  conn.sendIq(item, noop)
}

export function rosterRemove(conn: XmppTransport, jid: string): void {
  conn.sendIq(
    $iq({ type: 'set', id: conn.uniqueId('roster-del') })
      .c('query', { xmlns: NS.ROSTER })
      .c('item', { jid, subscription: 'remove' }),
    noop
  )
}
