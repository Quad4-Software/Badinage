// Jingle feature delegates for XmppConnection: send prebuilt jingle
// iqs, probe a full jid for jingle support, and ask our server for
// external stun and turn relays. Keeps the connection file thin.

import type { StanzaBuilder, XmppTransport } from '../features/transport'
import { discoInfo } from '../features/disco'
import { NS } from '../ns'
import { discoverServices, type ExtService } from './extdisco'

export function sendJingleIq(
  conn: XmppTransport,
  stanza: StanzaBuilder,
  onDone?: (ok: boolean) => void
): void {
  conn.sendIq(
    stanza,
    () => onDone?.(true),
    () => onDone?.(false)
  )
}

export function probeJingleSupport(
  conn: XmppTransport,
  jid: string,
  onDone: (supported: boolean) => void
): void {
  discoInfo(conn, jid, undefined, (info) => {
    onDone(info?.features.includes(NS.JINGLE) === true)
  })
}

export function fetchExtServices(
  conn: XmppTransport,
  onDone: (services: ExtService[]) => void
): void {
  discoverServices(conn, onDone)
}
