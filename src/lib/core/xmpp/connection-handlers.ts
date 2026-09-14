// Stanza handler registration for XmppConnection: the seven addHandler
// calls wired on every connect. Extracted so connection.ts stays under
// the file size gate. Behavior is identical to the previous inline block.

import type { Strophe } from 'strophe.js'

import type { Emitter } from '$lib/core/events'

import {
  handleBlockPush,
  handleDiscoInfoGet,
  handleDiscoItemsGet,
  handleJingle,
  handleMessage,
  handlePing,
  handlePresence,
  handleRosterPush
} from './features/handlers'
import type { XmppTransport } from './features/transport'
import { NS } from './ns'
import type { ConnectionEvents } from './types'

type StropheConnection = InstanceType<typeof Strophe.Connection>

// strophe stashes the last stream:features element on the connection.
// collect the advertised xmlns into the caller's set so feature-gated
// sends (carbons, csi) can check them.
export function noteStreamFeatures(conn: StropheConnection, into: Set<string>): void {
  into.clear()
  const features = conn.features
  if (!features) return
  for (const child of features.childNodes) {
    if (child.nodeType !== 1) continue
    const xmlns = (child as Element).getAttribute('xmlns')
    if (xmlns) into.add(xmlns)
  }
}

// The XmppTransport every feature module sends through. send drops the
// stanza when it races a teardown (conn._proto is null inside strophe).
// the stream is gone anyway.
export function makeTransport(
  conn: StropheConnection,
  sendIq: XmppTransport['sendIq']
): XmppTransport {
  return {
    sendIq,
    send: (stanza) => {
      if (conn.connected) conn.send(stanza)
    },
    uniqueId: (prefix) => conn.getUniqueId(prefix),
    get jid() {
      return conn.jid ?? ''
    }
  }
}

export function registerStanzaHandlers(
  conn: StropheConnection,
  transport: XmppTransport,
  events: Emitter<ConnectionEvents>,
  ownBareJid: () => string,
  mamQueries: ReadonlySet<string>
): void {
  conn.addHandler(
    (stanza) => handleMessage(stanza, events, ownBareJid(), mamQueries),
    null,
    'message',
    null
  )
  conn.addHandler((stanza) => handlePresence(stanza, events, transport), null, 'presence', null)
  conn.addHandler(
    (stanza) => handleRosterPush(stanza, events, transport, ownBareJid()),
    NS.ROSTER,
    'iq',
    'set'
  )
  conn.addHandler(
    (stanza) => handleBlockPush(stanza, events, transport, ownBareJid()),
    NS.BLOCKING,
    'iq',
    'set'
  )
  // XEP-0199: answer pings. MUC self-ping relies on the room routing
  // our own ping back at us
  conn.addHandler((stanza) => handlePing(stanza, events, transport), NS.PING, 'iq', 'get')
  // XEP-0030/0115: peers disco us to resolve the caps ver we advertise
  // in presence into a feature list
  conn.addHandler((stanza) => handleDiscoInfoGet(stanza, transport), NS.DISCO_INFO, 'iq', 'get')
  conn.addHandler((stanza) => handleDiscoItemsGet(stanza, transport), NS.DISCO_ITEMS, 'iq', 'get')
  // XEP-0166: jingle session actions arrive as iq set stanzas
  conn.addHandler((stanza) => handleJingle(stanza, events, transport), NS.JINGLE, 'iq', 'set')
}
