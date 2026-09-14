// Wire validators pare untrusted worker announcements down to known
// shapes. Malformed entries drop silently, caps hold, and nothing the
// extension sent crosses over unvalidated.

import { describe, expect, it } from 'vitest'

import { EXT_LIMITS } from './types'
import { parseCommands, parseDecoration, parseMenuItems, parseSettingsFields } from './wire'

describe('parseMenuItems', () => {
  it('keeps well-formed items and drops the rest', () => {
    const items = parseMenuItems([
      { id: 'a', section: 'chat.message', label: 'Do it' },
      { id: 'b', section: 'chat.message', label: 'Risky', danger: true },
      { id: 'c', label: 'no section' },
      'garbage',
      { id: 1, section: 's', label: 'l' },
      { id: 'd', section: 's', label: 42 }
    ])
    expect(items).toEqual([
      { id: 'a', section: 'chat.message', label: 'Do it' },
      { id: 'b', section: 'chat.message', label: 'Risky', danger: true }
    ])
  })

  it('caps at the menu limit and truncates labels', () => {
    const items = parseMenuItems(
      Array.from({ length: 30 }, (_, i) => ({
        id: `i${i}`,
        section: 's',
        label: 'x'.repeat(200)
      }))
    )
    expect(items).toHaveLength(EXT_LIMITS.menuItemsMax)
    expect(items[0]?.label.length).toBe(80)
  })
})

describe('parseCommands', () => {
  it('keeps lowercase word commands and drops bad names', () => {
    const items = parseCommands([
      { id: 'c1', name: 'shrug', description: 'send a shrug' },
      { id: 'c2', name: 'translate-2' },
      { id: 'c3', name: 'UPPER' },
      { id: 'c4', name: '/slash' },
      { id: 'c5', name: '' },
      { id: 'c6', name: 'with space' },
      { name: 'noid' }
    ])
    expect(items).toEqual([
      { id: 'c1', name: 'shrug', description: 'send a shrug' },
      { id: 'c2', name: 'translate-2', description: '' }
    ])
  })

  it('refuses duplicate names within one announcement', () => {
    const items = parseCommands([
      { id: 'a', name: 'dup' },
      { id: 'b', name: 'dup' }
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('a')
  })

  it('caps at the command limit', () => {
    const items = parseCommands(
      Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `cmd${i}` }))
    )
    expect(items).toHaveLength(EXT_LIMITS.commandsMax)
  })
})

describe('parseSettingsFields', () => {
  it('keeps valid fields of every type', () => {
    const fields = parseSettingsFields([
      { key: 'api_key', type: 'text', label: 'API key' },
      { key: 'limit', type: 'number', label: 'Limit', default: 10 },
      { key: 'enabled', type: 'checkbox', label: 'On', default: true },
      { key: 'mode', type: 'select', label: 'Mode', options: ['a', 'b'], default: 'a' }
    ])
    expect(fields).toHaveLength(4)
    expect(fields[3]?.options).toEqual(['a', 'b'])
  })

  it('drops selects without options and fields with bad keys', () => {
    const fields = parseSettingsFields([
      { key: 'mode', type: 'select', label: 'Mode' },
      { key: 'mode', type: 'select', label: 'Mode', options: [] },
      { key: '9bad', type: 'text', label: 'Bad key' },
      { key: 'with space', type: 'text', label: 'Bad key' },
      { key: 'ok', type: 'text', label: 'Ok' }
    ])
    expect(fields).toEqual([{ key: 'ok', type: 'text', label: 'Ok' }])
  })

  it('caps options and fields at their limits', () => {
    const fields = parseSettingsFields([
      {
        key: 'big',
        type: 'select',
        label: 'Big',
        options: Array.from({ length: 50 }, (_, i) => `o${i}`)
      }
    ])
    expect(fields[0]?.options).toHaveLength(EXT_LIMITS.settingOptionsMax)
  })
})

describe('parseDecoration', () => {
  it('returns footer and title when present', () => {
    expect(parseDecoration({ footer: 'via bot', title: 'extension x' })).toEqual({
      footer: 'via bot',
      title: 'extension x'
    })
  })

  it('returns null for empty or malformed results', () => {
    expect(parseDecoration(null)).toBeNull()
    expect(parseDecoration('text')).toBeNull()
    expect(parseDecoration({})).toBeNull()
    expect(parseDecoration({ footer: 42 })).toBeNull()
  })

  it('truncates oversized text', () => {
    const d = parseDecoration({ footer: 'x'.repeat(500) })
    expect(d?.footer?.length).toBe(EXT_LIMITS.decorationTextMax)
  })
})
