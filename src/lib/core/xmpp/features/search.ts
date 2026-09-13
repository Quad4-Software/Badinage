// XEP-0433 extended channel search: a two-step iq exchange with a
// search service (typically a MUC component). Step one fetches the
// search form (jabber:x:data), step two submits it and gets result
// items with enough metadata to join without per-room disco.

import { $iq } from 'strophe.js'

import { NS } from '../ns'
import {
  parseChannelSearchItems,
  parseDataForm,
  type ChannelSearchItem,
  type DataForm
} from '../stanzas'
import { appendSubmitForm } from './dataforms'
import type { XmppTransport } from './transport'

// iq get with an empty search element returns the service's search
// form. Null when the jid does not run the protocol or errors.
export function channelSearchForm(
  conn: XmppTransport,
  service: string,
  onDone: (form: DataForm | null) => void
): void {
  conn.sendIq(
    $iq({ type: 'get', to: service, id: conn.uniqueId('search') }).c('search', {
      xmlns: NS.CHANNEL_SEARCH
    }),
    (stanza) => onDone(parseDataForm(stanza)),
    () => onDone(null)
  )
}

// Submit the form (type=submit fields with values filled in) and parse
// the result items. Only fields with at least one value are submitted.
// the service fills defaults for the rest.
export function channelSearch(
  conn: XmppTransport,
  service: string,
  form: DataForm,
  onDone: (items: ChannelSearchItem[] | null) => void
): void {
  const filled: DataForm = {
    ...form,
    fields: form.fields.filter((field) => field.values.some((value) => value !== ''))
  }
  const iq = $iq({ type: 'get', to: service, id: conn.uniqueId('search') }).c('search', {
    xmlns: NS.CHANNEL_SEARCH
  })
  appendSubmitForm(iq, filled)
  conn.sendIq(
    iq,
    (stanza) => onDone(parseChannelSearchItems(stanza)),
    () => onDone(null)
  )
}

// The discover step: probe a candidate jid for the search feature via
// disco#info. Callers iterate disco#items results of the account domain.
export const CHANNEL_SEARCH_FEATURE = `${NS.CHANNEL_SEARCH}`
