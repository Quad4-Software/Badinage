// Message stanza generator: random <message> trees mixing real XMPP
// payload children with junk, optionally wrapped in carbons or MAM
// forwarding. sid/stamp track generated values so tests can assert the
// parser recovered them.

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
  stamp,
  text,
  textUnit
} from './common'
import type { StanzaCase } from './common'

interface MsgChild {
  frag: string
  sid: string | undefined
  stamp: string | undefined
}

const leaf = (frag: string): MsgChild => ({ frag, sid: undefined, stamp: undefined })

const fileChild = fc
  .record({
    name: fc.option(fc.string({ unit: textUnit, maxLength: 12 }), { nil: undefined }),
    size: fc.option(
      fc.oneof(
        fc.integer({ min: 0, max: 1_000_000_000 }).map(String),
        fc.string({ unit: textUnit, maxLength: 6 })
      ),
      { nil: undefined }
    ),
    mediaType: fc.option(fc.constantFrom('image/png', 'image/jpeg', 'audio/ogg', 'text/plain'), {
      nil: undefined
    }),
    duration: fc.option(fc.integer({ min: 0, max: 9999 }).map(String), { nil: undefined })
  })
  .map((r) => {
    let inner = ''
    if (r.name !== undefined) inner += `<name>${escText(r.name)}</name>`
    if (r.size !== undefined) inner += `<size>${escText(r.size)}</size>`
    if (r.mediaType !== undefined) inner += `<media-type>${r.mediaType}</media-type>`
    if (r.duration !== undefined) inner += `<duration>${r.duration}</duration>`
    return leaf(`<file xmlns="${NS.FILE_METADATA}">${inner}</file>`)
  })

const encryptedChild = fc
  .tuple(
    fc.constantFrom(NS.OMEMO, NS.OMEMO_LEGACY),
    idText,
    fc.string({ unit: fc.constantFrom('A', 'B', 'C', '1', '2', '=', '+'), maxLength: 16 })
  )
  .map(([ns, sid, payload]) =>
    leaf(
      `<encrypted xmlns="${ns}"><header sid="${escAttr(sid)}">` +
        `<keys jid="a@b.c"><key rid="1">AAAA</key></keys></header>` +
        `<payload>${payload}</payload></encrypted>`
    )
  )

const msgChildArb: fc.Arbitrary<MsgChild> = fc.oneof(
  text.map((t) => leaf(`<body>${escText(t)}</body>`)),
  text.map((t) => leaf(`<subject>${escText(t)}</subject>`)),
  text.map((t) => leaf(`<thread>${escText(t)}</thread>`)),
  fc.record({ id: idText, by: jidText }).map((r) => ({
    frag: `<stanza-id xmlns="${NS.STANZA_IDS}" id="${escAttr(r.id)}" by="${escAttr(r.by)}"/>`,
    sid: r.id,
    stamp: undefined
  })),
  idText.map((id) => leaf(`<origin-id xmlns="${NS.STANZA_IDS}" id="${escAttr(id)}"/>`)),
  stamp.map((st) => ({
    frag: `<delay xmlns="${NS.DELAY}" stamp="${escAttr(st)}"/>`,
    sid: undefined,
    stamp: st
  })),
  fc
    .constantFrom('active', 'composing', 'paused', 'inactive', 'gone')
    .map((s) => leaf(`<${s} xmlns="${NS.CHAT_STATES}"/>`)),
  fc.constant(leaf(`<request xmlns="${NS.RECEIPTS}"/>`)),
  idText.map((id) => leaf(`<received xmlns="${NS.RECEIPTS}" id="${escAttr(id)}"/>`)),
  fc
    .tuple(fc.constantFrom('received', 'displayed', 'acknowledged'), idText)
    .map(([m, id]) => leaf(`<${m} xmlns="${NS.MARKERS}" id="${escAttr(id)}"/>`)),
  fc
    .tuple(idText, jidText)
    .map(([id, to]) =>
      leaf(`<reply xmlns="${NS.REPLY}" id="${escAttr(id)}" to="${escAttr(to)}"/>`)
    ),
  fc
    .tuple(idText, fc.array(fc.string({ unit: textUnit, maxLength: 4 }), { maxLength: 3 }))
    .map(([id, emojis]) =>
      leaf(
        `<reactions xmlns="${NS.REACTIONS}" id="${escAttr(id)}">` +
          emojis.map((e) => `<reaction>${escText(e)}</reaction>`).join('') +
          '</reactions>'
      )
    ),
  idText.map((id) => leaf(`<replace xmlns="${NS.CORRECT}" id="${escAttr(id)}"/>`)),
  text.map((u) => leaf(`<x xmlns="${NS.OOB}"><url>${escText(u)}</url></x>`)),
  fileChild,
  encryptedChild,
  junkSpecArb(1).map((j) => leaf(junkXml(j)))
)

export const messageArb: fc.Arbitrary<StanzaCase> = fc
  .record({
    type: fc.option(fc.constantFrom('chat', 'groupchat', 'normal', 'headline', 'error'), {
      nil: undefined
    }),
    from: fc.option(jidText, { nil: undefined }),
    to: fc.option(jidText, { nil: undefined }),
    id: fc.option(idText, { nil: undefined }),
    children: fc.array(msgChildArb, { maxLength: 8 }),
    wrap: fc.constantFrom('none', 'carbon-sent', 'carbon-received', 'mam'),
    fwdDelay: fc.option(stamp, { nil: undefined })
  })
  .map((s) => {
    const inner =
      `<message${attrStr('from', s.from)}${attrStr('to', s.to)}${attrStr('type', s.type)}` +
      `${attrStr('id', s.id)}>` +
      s.children.map((c) => c.frag).join('') +
      '</message>'
    const stanzaId = s.children.find((c) => c.sid !== undefined)?.sid
    const innerDelay = s.children.find((c) => c.stamp !== undefined)?.stamp
    if (s.wrap === 'none') {
      return { kind: 'message' as const, xml: inner, stanzaId, delayStamp: innerDelay }
    }
    const fwdDelayXml =
      s.fwdDelay === undefined ? '' : `<delay xmlns="${NS.DELAY}" stamp="${escAttr(s.fwdDelay)}"/>`
    const forwarded = `<forwarded xmlns="${NS.FORWARD}">${fwdDelayXml}${inner}</forwarded>`
    let outer: string
    if (s.wrap === 'mam') {
      outer =
        `<message${attrStr('from', s.from)}${attrStr('to', s.to)}>` +
        `<result xmlns="${NS.MAM}" id="q1">${forwarded}</result></message>`
    } else {
      const dir = s.wrap === 'carbon-sent' ? 'sent' : 'received'
      outer =
        `<message from="me@example.net" to="me@example.net/home">` +
        `<${dir} xmlns="${NS.CARBONS}">${forwarded}</${dir}></message>`
    }
    return { kind: 'message' as const, xml: outer, stanzaId, delayStamp: s.fwdDelay ?? innerDelay }
  })
