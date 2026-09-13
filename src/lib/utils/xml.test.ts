import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { allNsTags, firstNsTag, firstTag, firstTagText, serializeElement } from './xml'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  return doc as unknown as Element
}

const ROOT = `<root xmlns:a="urn:a" xmlns:b="urn:b">
  <a:item>first</a:item>
  <a:item>second</a:item>
  <b:item>other-ns</b:item>
  <plain>text</plain>
</root>`

describe('firstTag', () => {
  it('finds the first descendant by qualified name', () => {
    const el = firstTag(xml(ROOT), 'plain')
    expect(el?.textContent).toBe('text')
  })

  it('returns null when nothing matches', () => {
    expect(firstTag(xml(ROOT), 'missing')).toBeNull()
  })

  it('does not match the element itself', () => {
    expect(firstTag(xml(`<wrap><wrap>inner</wrap></wrap>`), 'wrap')?.textContent).toBe('inner')
  })
})

describe('firstNsTag', () => {
  it('matches local name within the given namespace only', () => {
    expect(firstNsTag(xml(ROOT), 'urn:a', 'item')?.textContent).toBe('first')
    expect(firstNsTag(xml(ROOT), 'urn:b', 'item')?.textContent).toBe('other-ns')
    expect(firstNsTag(xml(ROOT), 'urn:c', 'item')).toBeNull()
  })
})

describe('allNsTags', () => {
  it('collects every match in document order', () => {
    const items = allNsTags(xml(ROOT), 'urn:a', 'item')
    expect(items.map((el) => el.textContent)).toEqual(['first', 'second'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(allNsTags(xml(ROOT), 'urn:a', 'missing')).toEqual([])
  })
})

describe('firstTagText', () => {
  it('returns the text of the first match or null', () => {
    const root = xml(ROOT)
    expect(firstTagText(root, 'plain')).toBe('text')
    expect(firstTagText(root, 'missing')).toBeNull()
  })
})

describe('serializeElement', () => {
  it('round-trips the element markup', () => {
    const root = xml(ROOT)
    const item = firstNsTag(root, 'urn:a', 'item')
    if (!item) throw new Error('missing fixture element')
    const serialized = serializeElement(item)
    expect(serialized).toContain('item')
    expect(serialized).toContain('first')
  })
})
