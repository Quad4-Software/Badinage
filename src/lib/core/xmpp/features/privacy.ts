// XEP-0186 invisibility through a privacy list (XEP-0016): a named list
// that denies outbound presence, set active while invisible and cleared
// to go visible again. The alternative, sending presence
// type='invisible', was removed from RFC 6121; privacy lists are what
// servers actually implement.
//
// Caveat the caller must surface: presence-out also carries MUC joins,
// so an invisible account cannot enter rooms until it turns visible.

import { $iq } from 'strophe.js'

import { NS } from '../ns'
import type { XmppTransport } from './transport'

const INVISIBLE_LIST = 'invisible'

// (de)activate the deny-presence-out list. Two chained iq sets: define
// the list, then point <active/> at it (or clear active when turning
// off). onDone gets false on the first failing step.
export function setInvisible(
  conn: XmppTransport,
  enabled: boolean,
  onDone: (ok: boolean) => void
): void {
  const deactivate = () => {
    conn.sendIq(
      $iq({ type: 'set', id: conn.uniqueId('invisible') })
        .c('query', { xmlns: NS.PRIVACY })
        .c('active'),
      () => onDone(true),
      () => onDone(false)
    )
  }
  if (!enabled) {
    deactivate()
    return
  }
  conn.sendIq(
    $iq({ type: 'set', id: conn.uniqueId('invisible') })
      .c('query', { xmlns: NS.PRIVACY })
      .c('list', { name: INVISIBLE_LIST })
      .c('item', { action: 'deny', order: '1' })
      .c('presence-out'),
    () => {
      conn.sendIq(
        $iq({ type: 'set', id: conn.uniqueId('invisible') })
          .c('query', { xmlns: NS.PRIVACY })
          .c('active', { name: INVISIBLE_LIST }),
        () => onDone(true),
        () => onDone(false)
      )
    },
    () => onDone(false)
  )
}
