export const JUMBO_EMOJI_MAX = 27

// jumbo only ever applies to short bodies, bail early on long text
const MAX_TEXT_LEN = 400

const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u
// digits, # and * are Emoji_Component, so require a real pictograph too
// (alternation keeps regional indicators and the keycap mark out of a class)
const REAL_EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// returns the grapheme count when the text is emoji-only, else 0
export function emojiOnlyCount(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > MAX_TEXT_LEN) return 0
  if (!EMOJI_ONLY_RE.test(trimmed) || !REAL_EMOJI_RE.test(trimmed)) return 0
  const count = [...segmenter.segment(trimmed)].length
  if (count > JUMBO_EMOJI_MAX) return 0
  return count
}

export function isEmojiOnly(text: string): boolean {
  return emojiOnlyCount(text) > 0
}

// hexcodes are dash separated uppercase hex, eg '1F468-200D-1F469-200D-1F467'
export function hexcodeToEmoji(hexcode: string): string {
  return String.fromCodePoint(...hexcode.split('-').map((part) => parseInt(part, 16)))
}
