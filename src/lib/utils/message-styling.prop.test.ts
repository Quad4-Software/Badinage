import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { tokenizeStyling, type BlockToken, type SpanToken } from './message-styling'

// total characters the token tree can render back; styling directives are
// consumed, so the tree can never hold more text than the input
function leafLength(blocks: BlockToken[]): number {
  const spans = (list: SpanToken[]): number =>
    list.reduce(
      (sum, span) =>
        sum +
        (span.type === 'code' || span.type === 'text' ? span.text.length : spans(span.children)),
      0
    )
  return blocks.reduce(
    (sum, block) =>
      sum +
      (block.type === 'line'
        ? spans(block.spans)
        : block.type === 'pre'
          ? block.text.length
          : leafLength(block.children)),
    0
  )
}

// strings that carry no styling surface at all: no span directive chars
// anywhere and no line starting with a block directive
const safeChar = fc.constantFrom('a', 'B', '1', ' ', '<', '&', 'é', '中', '😀', '?', '!', '-')
const safeLine = fc.string({ unit: safeChar, maxLength: 24 }).filter((s) => !s.startsWith('>'))
const safeBody = fc.array(safeLine).map((lines) => lines.join('\n'))

describe('property: message styling tokenizer', () => {
  it('never throws and never invents characters', () => {
    fc.assert(
      fc.property(fc.string(), (body) => {
        const blocks = tokenizeStyling(body)
        expect(leafLength(blocks)).toBeLessThanOrEqual(body.length)
      })
    )
  })

  it('passes directive-free text through untouched', () => {
    fc.assert(
      fc.property(safeBody, (body) => {
        const blocks = tokenizeStyling(body)
        const roundTrip = blocks
          .map((block) =>
            block.type === 'line'
              ? block.spans.map((span) => (span.type === 'text' ? span.text : '')).join('')
              : ''
          )
          .join('\n')
        expect(blocks.every((b) => b.type === 'line')).toBe(true)
        expect(roundTrip).toBe(body)
      })
    )
  })
})
