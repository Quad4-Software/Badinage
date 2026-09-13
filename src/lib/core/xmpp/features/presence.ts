// Outgoing <presence> senders and the vcard-temp avatar fetch.

import { $iq, $pres } from 'strophe.js'

import { NS } from '../ns'
import { parseVcardPhoto } from '../stanzas'
import type { XmppTransport } from './transport'

export function sendPresence(conn: XmppTransport, show?: string, status?: string): void {
  const pres = $pres()
  if (show) pres.c('show').t(show).up()
  if (status) pres.c('status').t(status).up()
  conn.send(pres)
}

export function sendDirectedPresence(
  conn: XmppTransport,
  to: string,
  type?: string,
  status?: string
): void {
  const pres = type ? $pres({ to, type }) : $pres({ to })
  if (status) pres.c('status').t(status)
  conn.send(pres)
}

// vcard-temp PHOTO fetch, used for room avatars. Delivers a data URI or
// undefined when the peer has no photo or the query errors.
export function fetchAvatar(
  conn: XmppTransport,
  jid: string,
  onDone: (dataUri: string | undefined) => void
): void {
  conn.sendIq(
    $iq({ type: 'get', to: jid, id: conn.uniqueId('vcard') }).c('vCard', {
      xmlns: NS.VCARD_TEMP
    }),
    (stanza) => onDone(parseVcardPhoto(stanza)),
    () => onDone(undefined)
  )
}
