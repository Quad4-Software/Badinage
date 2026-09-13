// XEP-0004 data forms on the wire: building a type=submit form out of
// a parsed DataForm. Parsing lives in stanzas.ts next to the other
// pure stanza readers.

import { NS } from '../ns'
import type { DataForm } from '../stanzas'
import type { StanzaBuilder } from './transport'

// Appends <x xmlns='jabber:x:data' type='submit'> with one field per
// entry of the form, positioned at wherever the builder currently
// points (the muc#owner query for room config). Hidden and fixed
// fields are echoed back with their parsed values so the server sees
// the complete form.
export function appendSubmitForm(parent: StanzaBuilder, form: DataForm): void {
  const x = parent.c('x', { xmlns: NS.FORMS, type: 'submit' })
  for (const field of form.fields) {
    // fixed fields are display-only and never submitted
    if (field.type === 'fixed') continue
    const f = x.c('field', { var: field.var })
    // booleans serialize as 1 or 0 per the XEP-0004 examples
    const values =
      field.type === 'boolean'
        ? [field.values[0] === 'true' || field.values[0] === '1' ? '1' : '0']
        : field.values
    for (const value of values) f.c('value').t(value).up()
    f.up()
  }
  x.up()
}
