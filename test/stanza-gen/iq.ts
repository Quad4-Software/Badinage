// Iq stanza generator: random <iq> trees whose children exercise the
// roster, blocking, disco, upload-slot, vcard and MAM-fin parsers, plus
// junk elements.

import fc from 'fast-check'

import { NS } from '$lib/core/xmpp/ns'

import {
  attrStr,
  escAttr,
  escText,
  idText,
  jidText,
  junkSpecArb,
  junkXml,
  textUnit
} from './common'
import type { StanzaCase } from './common'

const rosterQuery = fc
  .array(
    fc.record({
      jid: jidText,
      name: fc.option(fc.string({ unit: textUnit, maxLength: 10 }), { nil: undefined }),
      subscription: fc.option(fc.constantFrom('none', 'to', 'from', 'both', 'remove'), {
        nil: undefined
      }),
      ask: fc.option(fc.constantFrom('subscribe', 'unsubscribe'), { nil: undefined }),
      groups: fc.array(fc.string({ unit: textUnit, maxLength: 8 }), { maxLength: 2 })
    }),
    { maxLength: 4 }
  )
  .map(
    (items) =>
      `<query xmlns="${NS.ROSTER}">` +
      items
        .map(
          (i) =>
            `<item${attrStr('jid', i.jid)}${attrStr('name', i.name)}` +
            `${attrStr('subscription', i.subscription)}${attrStr('ask', i.ask)}>` +
            i.groups.map((g) => `<group>${escText(g)}</group>`).join('') +
            '</item>'
        )
        .join('') +
      '</query>'
  )

const blockingEl = fc
  .tuple(fc.constantFrom('block', 'unblock', 'blocklist'), fc.array(jidText, { maxLength: 4 }))
  .map(
    ([tag, jids]) =>
      `<${tag} xmlns="${NS.BLOCKING}">` +
      jids.map((j) => `<item jid="${escAttr(j)}"/>`).join('') +
      `</${tag}>`
  )

const discoItemsQuery = fc
  .array(
    fc.record({
      jid: jidText,
      name: fc.option(fc.string({ unit: textUnit, maxLength: 10 }), { nil: undefined }),
      node: fc.option(idText, { nil: undefined })
    }),
    { maxLength: 4 }
  )
  .map(
    (items) =>
      `<query xmlns="${NS.DISCO_ITEMS}">` +
      items
        .map(
          (i) =>
            `<item${attrStr('jid', i.jid)}${attrStr('name', i.name)}${attrStr('node', i.node)}/>`
        )
        .join('') +
      '</query>'
  )

const discoInfoQuery = fc
  .array(
    fc.oneof(
      fc.constantFrom(NS.HTTP_UPLOAD, NS.MAM, NS.ROSTER, NS.DISCO_ITEMS, 'urn:xmpp:fake'),
      idText
    ),
    { maxLength: 5 }
  )
  .map(
    (vars) =>
      `<query xmlns="${NS.DISCO_INFO}">` +
      vars.map((v) => `<feature var="${escAttr(v)}"/>`).join('') +
      '</query>'
  )

const slotEl = fc
  .record({
    mode: fc.constantFrom('attr', 'text', 'mixed'),
    putUrl: fc.string({ unit: textUnit, maxLength: 24 }),
    getUrl: fc.string({ unit: textUnit, maxLength: 24 }),
    dropGet: fc.boolean()
  })
  .map((s) => {
    const put =
      s.mode === 'text' ? `<put>${escText(s.putUrl)}</put>` : `<put url="${escAttr(s.putUrl)}"/>`
    const get = s.dropGet
      ? ''
      : s.mode === 'attr'
        ? `<get url="${escAttr(s.getUrl)}"/>`
        : `<get>${escText(s.getUrl)}</get>`
    return `<slot xmlns="${NS.HTTP_UPLOAD}">${put}${get}</slot>`
  })

const vcardEl = fc
  .record({
    type: fc.option(fc.constantFrom('image/png', 'image/jpeg', 'image/gif'), { nil: undefined }),
    binval: fc.option(
      fc.string({ unit: fc.constantFrom('A', 'B', 'a', '0', '+', '='), maxLength: 20 }),
      { nil: undefined }
    )
  })
  .map((s) => {
    let photo = ''
    if (s.type !== undefined || s.binval !== undefined) {
      photo =
        '<PHOTO>' +
        (s.type === undefined ? '' : `<TYPE>${s.type}</TYPE>`) +
        (s.binval === undefined ? '' : `<BINVAL>${s.binval}</BINVAL>`) +
        '</PHOTO>'
    }
    return `<vCard xmlns="${NS.VCARD_TEMP}">${photo}</vCard>`
  })

const mamFinEl = fc
  .record({
    complete: fc.option(fc.boolean(), { nil: undefined }),
    first: fc.option(idText, { nil: undefined }),
    last: fc.option(idText, { nil: undefined })
  })
  .map((s) => {
    const set =
      s.first === undefined && s.last === undefined
        ? ''
        : `<set xmlns="${NS.RSM}">` +
          (s.first === undefined ? '' : `<first>${s.first}</first>`) +
          (s.last === undefined ? '' : `<last>${s.last}</last>`) +
          '</set>'
    return `<fin xmlns="${NS.MAM}"${s.complete === undefined ? '' : ` complete="${s.complete}"`}>${set}</fin>`
  })

export const iqArb: fc.Arbitrary<StanzaCase> = fc
  .record({
    type: fc.constantFrom('get', 'set', 'result', 'error'),
    from: fc.option(jidText, { nil: undefined }),
    to: fc.option(jidText, { nil: undefined }),
    id: fc.option(idText, { nil: undefined }),
    children: fc.array(
      fc.oneof(
        rosterQuery,
        blockingEl,
        discoItemsQuery,
        discoInfoQuery,
        slotEl,
        vcardEl,
        mamFinEl,
        junkSpecArb(1).map(junkXml)
      ),
      { maxLength: 4 }
    )
  })
  .map((s) => ({
    kind: 'iq' as const,
    xml:
      `<iq${attrStr('type', s.type)}${attrStr('from', s.from)}${attrStr('to', s.to)}` +
      `${attrStr('id', s.id)}>${s.children.join('')}</iq>`,
    stanzaId: undefined,
    delayStamp: undefined
  }))
