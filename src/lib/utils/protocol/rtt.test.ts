import { describe, expect, it } from 'vitest'

import { applyRttOps, diffRtt } from './rtt'
import type { RttOp } from './rtt'

describe('applyRttOps', () => {
  it('inserts text at the end when p is omitted', () => {
    expect(applyRttOps('', [{ type: 't', text: 'hi' }])).toBe('hi')
    expect(applyRttOps('ab', [{ type: 't', text: 'cd' }])).toBe('abcd')
  })

  it('inserts at a position', () => {
    expect(applyRttOps('ac', [{ type: 't', p: 1, text: 'b' }])).toBe('abc')
  })

  it('erases backward by default', () => {
    expect(applyRttOps('abc', [{ type: 'e' }])).toBe('ab')
    expect(applyRttOps('abc', [{ type: 'e', n: 2 }])).toBe('a')
  })

  it('deletes forward from a position', () => {
    expect(applyRttOps('abcd', [{ type: 'd', p: 1, n: 2 }])).toBe('ad')
  })

  it('clamps out of range positions instead of corrupting', () => {
    expect(applyRttOps('ab', [{ type: 't', p: 99, text: 'x' }])).toBe('abx')
    expect(applyRttOps('ab', [{ type: 'e', n: 99 }])).toBe('')
  })

  it('counts positions in code points, not utf-16 units', () => {
    const emoji = 'a😀b'
    expect(applyRttOps(emoji, [{ type: 'e', p: 3 }])).toBe('a😀')
    expect(applyRttOps(emoji, [{ type: 't', p: 1, text: 'x' }])).toBe('ax😀b')
  })

  it('ignores wait elements', () => {
    expect(
      applyRttOps('ab', [
        { type: 'w', n: 300 },
        { type: 't', text: 'c' }
      ])
    ).toBe('abc')
  })

  it('applies ops in sequence', () => {
    const ops: RttOp[] = [{ type: 't', text: 'hello' }, { type: 'e' }, { type: 't', text: 'p' }]
    expect(applyRttOps('', ops)).toBe('hellp')
  })
})

describe('diffRtt', () => {
  it('emits nothing for identical strings', () => {
    expect(diffRtt('same', 'same')).toEqual([])
  })

  it('emits a single insert for appends', () => {
    expect(diffRtt('hel', 'hello')).toEqual([{ type: 't', p: 3, text: 'lo' }])
  })

  it('emits a single erase for backspaces', () => {
    expect(diffRtt('hello', 'hel')).toEqual([{ type: 'e', p: 5, n: 2 }])
  })

  it('handles a mid-string replacement', () => {
    const ops = diffRtt('hello world', 'hello brave world')
    expect(applyRttOps('hello world', ops)).toBe('hello brave world')
  })

  it('round-trips arbitrary edits through applyRttOps', () => {
    const cases: [string, string][] = [
      ['', 'hello'],
      ['hello', ''],
      ['abc', 'xyz'],
      ['the quick', 'the quixotic'],
      ['😀😀', '😀a😀']
    ]
    for (const [from, to] of cases) {
      expect(applyRttOps(from, diffRtt(from, to))).toBe(to)
    }
  })
})

describe('adversarial ops', () => {
  it('clamps negative positions', () => {
    expect(applyRttOps('ab', [{ type: 't', p: -10, text: 'x' }])).toBe('xab')
  })

  it('an absurd erase count just empties the buffer', () => {
    expect(applyRttOps('abc', [{ type: 'e', n: Number.MAX_SAFE_INTEGER }])).toBe('')
  })

  it('a delete past the end is a no-op on content', () => {
    expect(applyRttOps('abc', [{ type: 'd', p: 99, n: 5 }])).toBe('abc')
  })

  it('the buffer cap holds under a hostile insert flood', () => {
    const ops: RttOp[] = Array.from({ length: 50 }, () => ({
      type: 't' as const,
      text: 'x'.repeat(200)
    }))
    const out = applyRttOps('', ops)
    expect([...out].length).toBeLessThanOrEqual(16_384)
  })
})

describe('diffRtt property', () => {
  it('applyRttOps(a, diffRtt(a, b)) === b for arbitrary strings', async () => {
    const fc = (await import('fast-check')).default
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.string({ maxLength: 200 }), (a, b) => {
        expect(applyRttOps(a, diffRtt(a, b))).toBe(b)
      })
    )
  })
})
