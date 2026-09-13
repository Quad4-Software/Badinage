// Outgoing <presence> senders. The vcard-temp avatar fetch lives in
// avatars.ts.

import { $pres } from 'strophe.js'

import { NS } from '../ns'
import { ownCaps } from './caps'
import type { StanzaBuilder, XmppTransport } from './transport'

// XEP-0115: append the caps element to an available-presence stanza. The
// hash and ver are stable for the session so the same element goes out
// on every broadcast.
function withCaps(pres: StanzaBuilder): StanzaBuilder {
  const caps = ownCaps()
  return pres.c('c', {
    xmlns: NS.CAPS,
    hash: caps.hash,
    node: caps.node,
    ver: caps.ver
  })
}

export function sendPresence(conn: XmppTransport, show?: string, status?: string): void {
  const pres = $pres()
  if (show) pres.c('show').t(show).up()
  if (status) pres.c('status').t(status).up()
  conn.send(withCaps(pres))
}

// XEP-0115 section 8.3: directed presence should carry caps too, but
// only on available/unavailable transitions - subscription stanzas do
// not advertise capabilities.
export function sendDirectedPresence(
  conn: XmppTransport,
  to: string,
  type?: string,
  status?: string
): void {
  let pres = type ? $pres({ to, type }) : $pres({ to })
  if (status) pres.c('status').t(status).up()
  if (!type || type === 'unavailable') pres = withCaps(pres)
  conn.send(pres)
}
