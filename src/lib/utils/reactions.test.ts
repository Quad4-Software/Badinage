import { describe, expect, it } from 'vitest'

import { reactionSenderNames } from './reactions'

const identity = (sender: string): string => sender

describe('reactionSenderNames', () => {
  it('maps each sender key through the display function', () => {
    const { names, extra } = reactionSenderNames(['a@x.y', 'b@x.y'], (s) => s.split('@')[0] ?? s, 8)
    expect(names).toEqual(['a', 'b'])
    expect(extra).toBe(0)
  })

  it('dedupes after mapping to display names', () => {
    // two sender keys resolving to the same display name appear once
    const { names, extra } = reactionSenderNames(
      ['occupant-abc', 'aria'],
      (s) => (s === 'occupant-abc' ? 'aria' : s),
      8
    )
    expect(names).toEqual(['aria'])
    expect(extra).toBe(0)
  })

  it('caps the list and reports the remainder', () => {
    const senders = Array.from({ length: 10 }, (_, i) => `s${i}`)
    const { names, extra } = reactionSenderNames(senders, identity, 8)
    expect(names).toHaveLength(8)
    expect(extra).toBe(2)
  })
})
