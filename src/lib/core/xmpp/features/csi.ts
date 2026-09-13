// XEP-0352 client state indication: bare <active/> / <inactive/> nonzas
// telling the server whether the ui is in the foreground, so it can defer
// expensive traffic (presence storms, full payloads) while the tab hides.
// Sent unconditionally once the session is up: gating on a disco check
// lands when service discovery merges.

import { $build } from 'strophe.js'

import { NS } from '../ns'
import type { XmppTransport } from './transport'

export function sendClientState(conn: XmppTransport, active: boolean): void {
  conn.send($build(active ? 'active' : 'inactive', { xmlns: NS.CSI }))
}
