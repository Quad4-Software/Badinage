import { DOMParser } from '@xmldom/xmldom'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { allNsTags, firstNsTag, firstTag, firstTagText, serializeElement } from './xml'

const parser = new DOMParser()

const NS_POOL = ['urn:a', 'urn:b', 'urn:c', 'http://x/y', '']
const NAME_POOL = ['a', 'b', 'item', 'body', 'x', 'node', 'wrap', 'data', 'root']
const ATTR_NAME_POOL = ['id', 'key', 'name', 'data-x', 'code']
const textUnit = fc.constantFrom('a', 'B', '1', ' ', '<', '>', '&', '"', "'", '\n', 'é', '中')

interface ElSpec {
  ns: string
  local: string
  attrs: { name: string; value: string }[]
  text: string | undefined
  kids: ElSpec[]
}

function specArb(depth: number): fc.Arbitrary<ElSpec> {
  const kids =
    depth <= 0 ? fc.constant<ElSpec[]>([]) : fc.array(specArb(depth - 1), { maxLength: 3 })
  return fc.record({
    ns: fc.constantFrom(...NS_POOL),
    local: fc.constantFrom(...NAME_POOL),
    attrs: fc.array(
      fc.record({
        name: fc.constantFrom(...ATTR_NAME_POOL),
        value: fc.string({ unit: textUnit, maxLength: 10 })
      }),
      { maxLength: 3 }
    ),
    text: fc.option(fc.string({ unit: textUnit, maxLength: 16 }), { nil: undefined }),
    kids
  })
}

// Builds a <root/> document with the generated children and records every
// created element in document order for the expected-value computations.
function build(specs: ElSpec[]): { root: Element; created: Element[] } {
  const doc = parser.parseFromString('<root/>', 'application/xml') as unknown as Document
  const root = doc.documentElement
  if (!root) throw new Error('bad test xml')
  const created: Element[] = []
  const add = (spec: ElSpec, parent: Element) => {
    const el =
      spec.ns === '' ? doc.createElement(spec.local) : doc.createElementNS(spec.ns, spec.local)
    for (const attr of spec.attrs) {
      // a duplicate attribute name would just overwrite, which is fine
      if (!el.hasAttribute(attr.name)) el.setAttribute(attr.name, attr.value)
    }
    parent.appendChild(el)
    created.push(el)
    if (spec.text !== undefined) el.appendChild(doc.createTextNode(spec.text))
    for (const kid of spec.kids) add(kid, el)
  }
  for (const spec of specs) add(spec, root)
  return { root, created }
}

const scenario = fc.record({
  specs: fc.array(specArb(3), { maxLength: 4 }),
  qns: fc.constantFrom(...NS_POOL, 'urn:nope'),
  qlocal: fc.constantFrom(...NAME_POOL, 'missing'),
  pick: fc.nat()
})

describe('property: allNsTags', () => {
  it('returns exactly the ns+local matches in document order and nothing else', () => {
    fc.assert(
      fc.property(scenario, ({ specs, qns, qlocal }) => {
        const { root, created } = build(specs)
        const expected = created.filter((e) => e.namespaceURI === qns && e.localName === qlocal)
        const result = allNsTags(root, qns, qlocal)
        expect(result).toHaveLength(expected.length)
        expected.forEach((e, i) => expect(result[i]).toBe(e))
        for (const el of result) {
          expect(el.namespaceURI).toBe(qns)
          expect(el.localName).toBe(qlocal)
        }
      })
    )
  })
})

describe('property: firstNsTag', () => {
  it('returns the first ns+local descendant or null', () => {
    fc.assert(
      fc.property(scenario, ({ specs, qns, qlocal }) => {
        const { root, created } = build(specs)
        const expected = created.filter((e) => e.namespaceURI === qns && e.localName === qlocal)
        const first = firstNsTag(root, qns, qlocal)
        if (expected.length === 0) expect(first).toBeNull()
        else expect(first).toBe(expected[0])
      })
    )
  })
})

describe('property: firstTag and firstTagText', () => {
  it('firstTag returns the first descendant by qualified name', () => {
    fc.assert(
      fc.property(scenario, ({ specs, qlocal }) => {
        const { root, created } = build(specs)
        const byTag = created.filter((e) => e.tagName === qlocal)
        const first = firstTag(root, qlocal)
        if (byTag.length === 0) expect(first).toBeNull()
        else expect(first).toBe(byTag[0])
      })
    )
  })

  it('firstTagText equals firstTag().textContent or null', () => {
    fc.assert(
      fc.property(scenario, ({ specs, qlocal }) => {
        const { root, created } = build(specs)
        const byTag = created.filter((e) => e.tagName === qlocal)
        const expectedText = byTag.length === 0 ? null : (byTag[0]?.textContent ?? null)
        expect(firstTagText(root, qlocal)).toBe(expectedText)
      })
    )
  })
})

describe('property: serializeElement', () => {
  it('output re-parses to an element with the same localName and namespace', () => {
    fc.assert(
      fc.property(scenario, ({ specs, pick }) => {
        const { root, created } = build(specs)
        const target = created.length === 0 ? root : (created[pick % created.length] ?? root)
        const reparsed = parser.parseFromString(
          serializeElement(target),
          'application/xml'
        ) as unknown as Document
        const el = reparsed.documentElement
        expect(el?.localName).toBe(target.localName)
        expect(el?.namespaceURI ?? null).toBe(target.namespaceURI ?? null)
      })
    )
  })
})
