// XEP-0191 blocklist: fetch, block, unblock. The server also pushes
// block/unblock sets to every resource. Those arrive through the
// connection's stanza handlers, not here.

import { $iq } from 'strophe.js'

import { firstNsTag } from '$lib/utils/xml'

import { NS } from '../ns'
import { parseJidItems } from '../stanzas'
import { noop, type XmppTransport } from './transport'

export function fetchBlocklist(conn: XmppTransport, onDone: (jids: string[]) => void): void {
  conn.sendIq(
    $iq({ type: 'get', id: conn.uniqueId('blocklist') }).c('blocklist', {
      xmlns: NS.BLOCKING
    }),
    (stanza) => {
      const list = firstNsTag(stanza, NS.BLOCKING, 'blocklist')
      onDone(list ? parseJidItems(list) : [])
    },
    () => onDone([])
  )
}

export function blockJids(conn: XmppTransport, jids: string[]): void {
  if (jids.length === 0) return
  const block = $iq({ type: 'set', id: conn.uniqueId('block') }).c('block', {
    xmlns: NS.BLOCKING
  })
  for (const jid of jids) block.c('item', { jid }).up()
  conn.sendIq(block, noop)
}

// An empty list unblocks all.
export function unblockJids(conn: XmppTransport, jids: string[]): void {
  const unblock = $iq({ type: 'set', id: conn.uniqueId('unblock') }).c('unblock', {
    xmlns: NS.BLOCKING
  })
  for (const jid of jids) unblock.c('item', { jid }).up()
  conn.sendIq(unblock, noop)
}
