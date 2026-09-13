// XEP-0313 message archive queries. Result messages arrive as ordinary
// message events flagged mam=true; the iq result (fin) carries the rsm
// cursor for the page just returned.

import { $iq } from 'strophe.js'

import { NS } from '../ns'
import { parseMamFin, type MamPageResult } from '../stanzas'
import type { XmppTransport } from './transport'

const DEFAULT_PAGE_SIZE = 50

// Fetches one archive page. For DMs the archive is ours filtered by
// 'with'; for rooms the iq is addressed to the room and the 'with'
// field is omitted.
export function queryArchive(
  conn: XmppTransport,
  peerJid: string,
  opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
  onDone: (result: MamPageResult) => void
): void {
  const id = conn.uniqueId('mam')
  const attrs: Record<string, string> = { type: 'set', id }
  if (opts.room) attrs.to = peerJid
  const query = $iq(attrs).c('query', { xmlns: NS.MAM, queryid: id })
  const form = query
    .c('x', { xmlns: NS.FORMS, type: 'submit' })
    .c('field', { var: 'FORM_TYPE', type: 'hidden' })
    .c('value')
    .t(NS.MAM)
    .up()
    .up()
  if (!opts.room) {
    form.c('field', { var: 'with' }).c('value').t(peerJid).up().up()
  }
  form.up()
  const set = query.c('set', { xmlns: NS.RSM })
  set
    .c('max')
    .t(String(opts.max ?? DEFAULT_PAGE_SIZE))
    .up()
  if (opts.before) set.c('before').t(opts.before).up()
  conn.sendIq(
    query,
    (result) => onDone(parseMamFin(result)),
    () => onDone({ complete: true })
  )
}
