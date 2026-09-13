// Shared primitives for the stanza generators: xml escapers, small
// arbitraries, the junk-element generator mixed into every stanza, and
// the StanzaCase shape the tests assert against.

import fc from 'fast-check'

export const escText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const escAttr = (s: string): string => escText(s).replace(/"/g, '&quot;')
export const attrStr = (name: string, v: string | undefined): string =>
  v === undefined ? '' : ` ${name}="${escAttr(v)}"`

export const textUnit = fc.constantFrom(
  'a',
  'B',
  '1',
  ' ',
  '<',
  '>',
  '&',
  '"',
  "'",
  '\n',
  'é',
  '中',
  '😀'
)
export const text = fc.string({ unit: textUnit, maxLength: 24 })
export const idText = fc.string({
  unit: fc.constantFrom('a', 'b', 'c', '0', '1', '-', '_', '.'),
  minLength: 1,
  maxLength: 10
})
export const jidText = fc.string({
  unit: fc.constantFrom('a', 'b', '@', '/', '.', 'c', 'x', '-', '1', ' '),
  maxLength: 20
})
// stamp junk avoids tab/newline: attribute normalization would rewrite them
// and break the delay equality check
export const stampJunk = fc.string({
  unit: fc.constantFrom('a', 'B', '1', ' ', '<', '>', '&', '"', "'", 'é', '-', 'T', ':', 'Z'),
  maxLength: 20
})
export const stamp = fc.oneof(
  fc
    .date({
      min: new Date('2000-01-01T00:00:00Z'),
      max: new Date('2030-01-01T00:00:00Z'),
      noInvalidDate: true
    })
    .map((d) => d.toISOString()),
  stampJunk
)

export interface JunkSpec {
  name: string
  ns: string
  attrs: { n: string; v: string }[]
  text: string | undefined
  kids: JunkSpec[]
}

export function junkSpecArb(depth: number): fc.Arbitrary<JunkSpec> {
  const kids =
    depth <= 0 ? fc.constant<JunkSpec[]>([]) : fc.array(junkSpecArb(depth - 1), { maxLength: 2 })
  return fc.record({
    name: fc.constantFrom('junk', 'pad', 'foo', 'zzz', 'meta', 'wrap', 'body', 'item', 'status'),
    ns: fc.constantFrom('urn:junk:a', 'urn:junk:b', 'http://junk.example/x'),
    attrs: fc.array(
      fc.record({
        n: fc.constantFrom('id', 'k', 'data-j', 'jid'),
        v: fc.string({ unit: textUnit, maxLength: 8 })
      }),
      { maxLength: 3 }
    ),
    text: fc.option(fc.string({ unit: textUnit, maxLength: 12 }), { nil: undefined }),
    kids
  })
}

export function junkXml(spec: JunkSpec): string {
  const seen = new Set<string>()
  const attrs = spec.attrs
    .filter((a) => !seen.has(a.n) && seen.add(a.n))
    .map((a) => ` ${a.n}="${escAttr(a.v)}"`)
    .join('')
  const inner =
    (spec.text === undefined ? '' : escText(spec.text)) + spec.kids.map(junkXml).join('')
  return inner === ''
    ? `<${spec.name} xmlns="${spec.ns}"${attrs}/>`
    : `<${spec.name} xmlns="${spec.ns}"${attrs}>${inner}</${spec.name}>`
}

export interface StanzaCase {
  kind: 'message' | 'presence' | 'iq'
  xml: string
  stanzaId: string | undefined
  delayStamp: string | undefined
}
