// Resolves a named palette plus the optional custom accent hue into the
// custom properties App.svelte applies to the root element. Pure and
// unit tested. The palettes themselves live in palettes.ts.

import {
  DEFAULT_THEME,
  THEMES,
  oklch,
  type Resolved,
  type ThemeMode,
  type ThemePreset
} from './palettes'

// every custom property the theme system manages on the root element.
// applying a theme clears all of them first so stale values never leak
export const MANAGED_VARS: Record<keyof Resolved, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarRing: '--sidebar-ring'
}

export function isThemeId(id: unknown): id is string {
  return id === DEFAULT_THEME || THEMES.some((t) => t.id === id)
}

export function resolveTheme(id: unknown): ThemePreset | null {
  return THEMES.find((t) => t.id === id) ?? null
}

// a custom accent hue overrides the preset's primary family. The
// lightness steps mirror the former data-accent rules so custom hues
// keep working on top of any preset
function accentVars(mode: ThemeMode, hue: number): Record<string, string> {
  const primary = mode === 'dark' ? oklch(0.74, 0.15, hue) : oklch(0.55, 0.19, hue)
  const foreground = mode === 'dark' ? oklch(0.2, 0.01, 285.885) : oklch(0.985, 0, 0)
  return {
    '--primary': primary,
    '--primary-foreground': foreground,
    '--ring': primary,
    '--sidebar-primary': primary,
    '--sidebar-primary-foreground': foreground
  }
}

// resolves the settings triple into concrete custom properties. The
// default theme returns an empty map so the stylesheet owns the tokens.
export function themeVars(
  themeId: unknown,
  mode: ThemeMode,
  accentHue: number | null
): Record<string, string> {
  const found = resolveTheme(themeId)
  const vars: Record<string, string> = {}
  if (found) {
    const resolved = mode === 'dark' ? found.dark : found.light
    for (const [token, cssVar] of Object.entries(MANAGED_VARS)) {
      vars[cssVar] = resolved[token as keyof Resolved]
    }
  }
  if (accentHue !== null && Number.isFinite(accentHue)) {
    Object.assign(vars, accentVars(mode, ((accentHue % 360) + 360) % 360))
  }
  return vars
}
