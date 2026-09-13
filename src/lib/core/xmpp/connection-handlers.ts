// Stanza handler registration for XmppConnection: the seven addHandler
// calls wired on every connect. Extracted so connection.ts stays under
// the file size gate; behavior is identical to the previous inline block.

import type { Strophe } from 'strophe.js'

import type { Emitter } from '$lib/core/events'

import {
  handleBlockPush,
  handleDiscoInfoGet,
  handleDiscoItemsGet,
  handleMessage,
  handlePing,
  handlePresence,
  handleRosterPush
} from './features/handlers'
import type { XmppTransport } from './features/transport'
import { NS } from './ns'
import type { ConnectionEvents } from './types'

type StropheConnection = InstanceType<typeof Strophe.Connection>

export function registerStanzaHandlers(
  conn: StropheConnection,
  transport: XmppTransport,
  events: Emitter<ConnectionEvents>,
  ownBareJid: () => string
): void {
  conn.addHandler((stanza) => handleMessage(stanza, events, ownBareJid()), null, 'message', null)
  conn.addHandler((stanza) => handlePresence(stanza, events, transport), null, 'presence', null)
  conn.addHandler((stanza) => handleRosterPush(stanza, events, transport), NS.ROSTER, 'iq', 'set')
  conn.addHandler((stanza) => handleBlockPush(stanza, events, transport), NS.BLOCKING, 'iq', 'set')
  // XEP-0199: answer pings; MUC self-ping relies on the room routing
  // our own ping back at us
  conn.addHandler((stanza) => handlePing(stanza, events, transport), NS.PING, 'iq', 'get')
  // XEP-0030/0115: peers disco us to resolve the caps ver we advertise
  // in presence into a feature list
  conn.addHandler((stanza) => handleDiscoInfoGet(stanza, transport), NS.DISCO_INFO, 'iq', 'get')
  conn.addHandler((stanza) => handleDiscoItemsGet(stanza, transport), NS.DISCO_ITEMS, 'iq', 'get')
}
