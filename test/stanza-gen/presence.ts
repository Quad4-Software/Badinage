// Presence stanza generator: plain presence, subscription types, MUC
// occupant presence with random status codes, plus junk children.

import fc from 'fast-check'

import { NS } from '$lib/core/xmpp/ns'

import { attrStr, escAttr, escText, jidText, junkSpecArb, junkXml, text } from './common'
import type { StanzaCase } from './common'

export const presenceArb: fc.Arbitrary<StanzaCase> = fc
  .record({
    from: fc.option(jidText, { nil: undefined }),
    to: fc.option(jidText, { nil: undefined }),
    type: fc.option(
      fc.constantFrom(
        'unavailable',
        'subscribe',
        'subscribed',
        'unsubscribe',
        'unsubscribed',
        'probe',
        'error'
      ),
      { nil: undefined }
    ),
    show: fc.option(fc.constantFrom('away', 'chat', 'dnd', 'xa', 'weird'), { nil: undefined }),
    status: fc.option(text, { nil: undefined }),
    muc: fc.boolean(),
    affiliation: fc.constantFrom('owner', 'admin', 'member', 'none', 'outcast'),
    role: fc.constantFrom('moderator', 'participant', 'visitor', 'none'),
    codes: fc.array(
      fc.oneof(
        fc.constantFrom('110', '210', '100', '201', '301', '307'),
        fc.integer({ min: 0, max: 999 }).map(String)
      ),
      { maxLength: 4 }
    ),
    junk: fc.array(junkSpecArb(1), { maxLength: 3 })
  })
  .map((s) => {
    let kids = ''
    if (s.show !== undefined) kids += `<show>${s.show}</show>`
    if (s.status !== undefined) kids += `<status>${escText(s.status)}</status>`
    if (s.muc) {
      const codes = s.codes.map((c) => `<status code="${escAttr(c)}"/>`).join('')
      kids +=
        `<x xmlns="${NS.MUC_USER}">` +
        `<item affiliation="${s.affiliation}" role="${s.role}"/>${codes}</x>`
    }
    kids += s.junk.map(junkXml).join('')
    return {
      kind: 'presence' as const,
      xml:
        `<presence${attrStr('from', s.from)}${attrStr('to', s.to)}${attrStr('type', s.type)}>` +
        `${kids}</presence>`,
      stanzaId: undefined,
      delayStamp: undefined
    }
  })
