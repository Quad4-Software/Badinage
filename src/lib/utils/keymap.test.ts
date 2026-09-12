import { describe, expect, it } from 'vitest'

import { comboToString, displayCombo, eventMatchesCombo, parseCombo } from './keymap'

describe('parseCombo', () => {
  it('parses a simple key', () => {
    expect(parseCombo('a')).toEqual({ mod: false, shift: false, alt: false, key: 'a' })
  })

  it('parses modifiers', () => {
    expect(parseCombo('mod+shift+k')).toEqual({
      mod: true,
      shift: true,
      alt: false,
      key: 'k'
    })
  })

  it('treats ctrl and meta as mod', () => {
    expect(parseCombo('ctrl+c')?.mod).toBe(true)
    expect(parseCombo('meta+c')?.mod).toBe(true)
  })

  it('rejects empty input', () => {
    expect(parseCombo('')).toBeNull()
    expect(parseCombo('mod+')).toBeNull()
  })
})

describe('comboToString', () => {
  it('round-trips', () => {
    const combo = parseCombo('mod+shift+k')
    expect(combo && comboToString(combo)).toBe('mod+shift+k')
  })
})

describe('eventMatchesCombo', () => {
  const keyEvent = (init: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      key: '',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...init
    }) as KeyboardEvent

  it('matches a keyboard event', () => {
    const event = keyEvent({ key: 'k', ctrlKey: true, shiftKey: true })
    expect(eventMatchesCombo(event, 'mod+shift+k')).toBe(true)
    expect(eventMatchesCombo(event, 'mod+k')).toBe(false)
  })

  it('ignores bare modifier presses', () => {
    const event = keyEvent({ key: 'Control', ctrlKey: true })
    expect(eventMatchesCombo(event, 'mod')).toBe(false)
  })
})

describe('displayCombo', () => {
  it('formats for linux', () => {
    expect(displayCombo('mod+shift+k', false)).toBe('Ctrl+Shift+K')
  })

  it('formats for mac', () => {
    expect(displayCombo('mod+k', true)).toBe('Cmd+K')
  })
})
