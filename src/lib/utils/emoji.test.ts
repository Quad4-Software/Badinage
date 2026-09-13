import { describe, expect, it } from 'vitest'

import { emojiOnlyCount, isEmojiOnly, JUMBO_EMOJI_MAX } from './emoji'

describe('isEmojiOnly', () => {
  it('accepts a single emoji', () => {
    expect(isEmojiOnly('🔥')).toBe(true)
  })

  it('accepts repeated emoji', () => {
    expect(isEmojiOnly('🔥🔥🔥')).toBe(true)
  })

  it('counts a zwj family sequence as one cluster', () => {
    expect(isEmojiOnly('👨‍👩‍👧‍👦')).toBe(true)
    expect(emojiOnlyCount('👨‍👩‍👧‍👦')).toBe(1)
  })

  it('accepts a flag pair', () => {
    expect(isEmojiOnly('🇩🇪')).toBe(true)
  })

  it('accepts a keycap sequence', () => {
    expect(isEmojiOnly('1️⃣')).toBe(true)
  })

  it('accepts emoji separated by whitespace', () => {
    expect(isEmojiOnly('🔥 🔥')).toBe(true)
  })

  it('rejects plain text', () => {
    expect(isEmojiOnly('hello')).toBe(false)
  })

  it('rejects emoji mixed with text', () => {
    expect(isEmojiOnly('🔥 hi')).toBe(false)
  })

  it('rejects bare digits', () => {
    expect(isEmojiOnly('123')).toBe(false)
  })

  it('rejects more than the jumbo max', () => {
    expect(isEmojiOnly('🔥'.repeat(JUMBO_EMOJI_MAX + 1))).toBe(false)
    expect(emojiOnlyCount('🔥'.repeat(JUMBO_EMOJI_MAX))).toBe(JUMBO_EMOJI_MAX)
  })

  it('rejects empty text', () => {
    expect(isEmojiOnly('')).toBe(false)
  })
})
