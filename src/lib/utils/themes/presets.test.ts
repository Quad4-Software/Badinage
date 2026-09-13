import { describe, expect, it } from 'vitest'

import { DEFAULT_THEME, THEMES } from './palettes'
import { isThemeId, MANAGED_VARS, resolveTheme, themeVars } from './presets'

describe('theme presets', () => {
  it('gives every preset a complete token set for both modes', () => {
    for (const theme of THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        const vars = themeVars(theme.id, mode, null)
        for (const cssVar of Object.values(MANAGED_VARS)) {
          expect(vars[cssVar], `${theme.id} ${mode} ${cssVar}`).toMatch(/^oklch\(/)
        }
      }
    }
  })

  it('resolves the default theme to no overrides', () => {
    expect(themeVars(DEFAULT_THEME, 'dark', null)).toEqual({})
    expect(themeVars('nonexistent', 'light', null)).toEqual({})
  })

  it('lets a custom accent hue override the preset primary family', () => {
    const vars = themeVars('ocean', 'light', 120)
    expect(vars['--primary']).toBe('oklch(0.55 0.19 120)')
    expect(vars['--ring']).toBe('oklch(0.55 0.19 120)')
    expect(vars['--sidebar-primary']).toBe('oklch(0.55 0.19 120)')
    // non-primary tokens still come from the preset
    expect(vars['--background']).toContain('oklch')
    expect(vars['--muted']).toContain('oklch')
  })

  it('uses dark lightness steps for the accent in dark mode', () => {
    const vars = themeVars('ocean', 'dark', 264)
    expect(vars['--primary']).toBe('oklch(0.74 0.15 264)')
    expect(vars['--primary-foreground']).toContain('0.2')
  })

  it('applies the accent to the default theme too', () => {
    const vars = themeVars(DEFAULT_THEME, 'light', 340)
    expect(Object.keys(vars)).toHaveLength(5)
    expect(vars['--primary']).toContain('340')
  })

  it('wraps out-of-range hues', () => {
    expect(themeVars(DEFAULT_THEME, 'light', 380)['--primary']).toContain('20')
    expect(themeVars(DEFAULT_THEME, 'light', -10)['--primary']).toContain('350')
  })

  it('ignores a non-finite accent hue', () => {
    expect(themeVars(DEFAULT_THEME, 'light', Number.NaN)).toEqual({})
  })

  it('validates theme ids', () => {
    expect(isThemeId('default')).toBe(true)
    expect(isThemeId('midnight')).toBe(true)
    expect(isThemeId('nope')).toBe(false)
    expect(isThemeId(42)).toBe(false)
    expect(resolveTheme('slate')?.id).toBe('slate')
    expect(resolveTheme('nope')).toBeNull()
  })

  it('keeps preset ids unique', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(DEFAULT_THEME)
  })
})
