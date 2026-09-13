import { describe, expect, it } from 'vitest'

import { buildBackup, parseBackup } from './settings-backup'

const DEFAULTS: Record<string, unknown> = {
  sendWithEnter: true,
  notifications: true,
  accentHue: null,
  theme: 'default',
  density: 'comfortable',
  accountOrder: [] as string[],
  collapsedSections: [] as string[],
  keybindings: {} as Record<string, string>,
  accountMeta: {} as Record<string, unknown>,
  seenPrompts: {} as Record<string, number>
}

const ACTIONS = ['app.settings', 'chat.focusComposer'] as const

describe('buildBackup', () => {
  it('round-trips a valid blob', () => {
    const text = buildBackup({ ...DEFAULTS, theme: 'ocean' }, 'dark')
    const result = parseBackup(text, DEFAULTS, ACTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.settings.theme).toBe('ocean')
    expect(result.backup.mode).toBe('dark')
    expect(result.backup.dropped).toBe(0)
  })
})

describe('parseBackup', () => {
  it('rejects invalid json and non-objects', () => {
    expect(parseBackup('not json', DEFAULTS, ACTIONS).ok).toBe(false)
    expect(parseBackup('"str"', DEFAULTS, ACTIONS).ok).toBe(false)
    expect(parseBackup('[1,2]', DEFAULTS, ACTIONS).ok).toBe(false)
    expect(parseBackup('null', DEFAULTS, ACTIONS).ok).toBe(false)
  })

  it('rejects foreign kinds and newer versions', () => {
    expect(parseBackup('{"kind":"other","settings":{}}', DEFAULTS, ACTIONS).ok).toBe(false)
    expect(parseBackup('{"version":99,"settings":{"sounds":true}}', DEFAULTS, ACTIONS).ok).toBe(
      false
    )
  })

  it('rejects a blob with no usable keys', () => {
    expect(parseBackup('{"unknown":1,"alsoUnknown":[]}', DEFAULTS, ACTIONS).ok).toBe(false)
    expect(parseBackup('{}', DEFAULTS, ACTIONS).ok).toBe(false)
  })

  it('drops wrong-typed values and keeps the rest', () => {
    const result = parseBackup(
      '{"sendWithEnter":"yes","notifications":false,"sounds":1}',
      DEFAULTS,
      ACTIONS
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.settings).toEqual({ notifications: false })
    expect(result.backup.dropped).toBe(2)
  })

  it('accepts a bare settings object without the envelope', () => {
    const result = parseBackup('{"density":"compact"}', DEFAULTS, ACTIONS)
    expect(result.ok && result.backup.settings.density).toBe('compact')
  })

  it('validates enums against known ids', () => {
    const bad = parseBackup('{"theme":"nope","density":"huge"}', DEFAULTS, ACTIONS)
    expect(bad.ok).toBe(false)
    const good = parseBackup('{"theme":"slate","density":"compact"}', DEFAULTS, ACTIONS)
    expect(good.ok && good.backup.settings).toEqual({ theme: 'slate', density: 'compact' })
  })

  it('filters keybindings to known actions with parseable combos', () => {
    const result = parseBackup(
      JSON.stringify({
        keybindings: {
          'app.settings': 'ctrl+,',
          'chat.focusComposer': 'not a combo',
          'evil.action': 'mod+x',
          'app.settings2': 'mod+shift+l'
        }
      }),
      DEFAULTS,
      ACTIONS
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // ctrl is normalized to mod. Unknown actions and junk combos drop
    expect(result.backup.settings.keybindings).toEqual({ 'app.settings': 'mod+,' })
  })

  it('sanitizes accountMeta to known keys and types', () => {
    const result = parseBackup(
      JSON.stringify({
        accountMeta: {
          'a@b.c': { hue: 200, notify: false, invisible: true, evil: 'x' },
          'd@e.f': { hue: 'blue' },
          'g@h.i': 'not an object'
        }
      }),
      DEFAULTS,
      ACTIONS
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.settings.accountMeta).toEqual({
      'a@b.c': { hue: 200, notify: false, invisible: true }
    })
  })

  it('keeps only strings in array settings', () => {
    const result = parseBackup(
      '{"accountOrder":["a@b.c",42,"d@e.f"],"collapsedSections":["privacy",null]}',
      DEFAULTS,
      ACTIONS
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.settings.accountOrder).toEqual(['a@b.c', 'd@e.f'])
    expect(result.backup.settings.collapsedSections).toEqual(['privacy'])
  })

  it('keeps accentHue only as a finite number or null', () => {
    for (const value of ['"blue"', '{}', '1e999']) {
      const result = parseBackup(`{"accentHue":${value}}`, DEFAULTS, ACTIONS)
      expect(result.ok).toBe(false)
    }
    expect(parseBackup('{"accentHue":264}', DEFAULTS, ACTIONS).ok).toBe(true)
    expect(parseBackup('{"accentHue":null}', DEFAULTS, ACTIONS).ok).toBe(true)
  })

  it('keeps only finite numbers in seenPrompts', () => {
    const result = parseBackup(
      '{"seenPrompts":{"crash-reporting":1,"x":"yes","y":null,"z":2}}',
      DEFAULTS,
      ACTIONS
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.settings.seenPrompts).toEqual({ 'crash-reporting': 1, z: 2 })
  })

  it('ignores an invalid mode but keeps valid settings', () => {
    const result = parseBackup('{"mode":"neon","density":"compact"}', DEFAULTS, ACTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.mode).toBeUndefined()
    expect(result.backup.settings.density).toBe('compact')
  })
})
