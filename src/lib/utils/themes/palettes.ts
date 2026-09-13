// Named theme palettes. Each preset supplies the token surface for both
// modes. Secondary tokens default from the base tokens when a preset
// does not pin them explicitly. presets.ts resolves one of these plus
// the optional accent hue into concrete custom properties.

export type ThemeMode = 'light' | 'dark'

interface ThemeTokens {
  background: string
  foreground: string
  card: string
  primary: string
  primaryForeground: string
  muted: string
  mutedForeground: string
  border: string
  ring: string
  accent?: string
  accentForeground?: string
  popover?: string
  secondary?: string
  sidebar?: string
  sidebarPrimary?: string
  sidebarAccent?: string
}

export interface Resolved {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  border: string
  input: string
  ring: string
  sidebar: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  sidebarRing: string
}

export interface ThemePreset {
  id: string
  light: Resolved
  dark: Resolved
}

export const oklch = (l: number, c: number, h: number) => `oklch(${l} ${c} ${h})`

function fill(t: ThemeTokens): Resolved {
  return {
    ...t,
    cardForeground: t.foreground,
    popover: t.popover ?? t.card,
    popoverForeground: t.foreground,
    secondary: t.secondary ?? t.muted,
    secondaryForeground: t.foreground,
    accent: t.accent ?? t.muted,
    accentForeground: t.accentForeground ?? t.foreground,
    input: t.border,
    sidebar: t.sidebar ?? t.card,
    sidebarForeground: t.foreground,
    sidebarPrimary: t.sidebarPrimary ?? t.primary,
    sidebarPrimaryForeground: t.primaryForeground,
    sidebarAccent: t.sidebarAccent ?? t.muted,
    sidebarAccentForeground: t.accentForeground ?? t.foreground,
    sidebarBorder: t.border,
    sidebarRing: t.ring
  }
}

function preset(id: string, light: ThemeTokens, dark: ThemeTokens): ThemePreset {
  return { id, light: fill(light), dark: fill(dark) }
}

// 'default' maps to the stylesheet values, so it produces no overrides
export const THEMES: ThemePreset[] = [
  preset(
    'slate',
    {
      background: oklch(0.985, 0.004, 255),
      foreground: oklch(0.21, 0.02, 255),
      card: oklch(0.995, 0.002, 255),
      primary: oklch(0.44, 0.09, 258),
      primaryForeground: oklch(0.985, 0, 0),
      muted: oklch(0.95, 0.007, 255),
      mutedForeground: oklch(0.5, 0.02, 255),
      border: oklch(0.9, 0.008, 255),
      ring: oklch(0.56, 0.05, 258)
    },
    {
      background: oklch(0.16, 0.01, 258),
      foreground: oklch(0.96, 0.005, 255),
      card: oklch(0.2, 0.013, 258),
      primary: oklch(0.73, 0.1, 258),
      primaryForeground: oklch(0.17, 0.01, 258),
      muted: oklch(0.26, 0.015, 258),
      mutedForeground: oklch(0.71, 0.02, 255),
      border: oklch(0.3, 0.015, 258),
      ring: oklch(0.62, 0.06, 258)
    }
  ),
  preset(
    'ocean',
    {
      background: oklch(0.98, 0.007, 225),
      foreground: oklch(0.22, 0.03, 250),
      card: oklch(0.99, 0.004, 225),
      primary: oklch(0.5, 0.13, 235),
      primaryForeground: oklch(0.985, 0, 0),
      muted: oklch(0.945, 0.012, 225),
      mutedForeground: oklch(0.48, 0.03, 240),
      accent: oklch(0.92, 0.03, 220),
      accentForeground: oklch(0.28, 0.05, 240),
      border: oklch(0.895, 0.013, 228),
      ring: oklch(0.55, 0.09, 235),
      sidebar: oklch(0.96, 0.01, 225)
    },
    {
      background: oklch(0.17, 0.02, 250),
      foreground: oklch(0.95, 0.01, 230),
      card: oklch(0.21, 0.025, 245),
      primary: oklch(0.72, 0.11, 230),
      primaryForeground: oklch(0.17, 0.02, 250),
      muted: oklch(0.26, 0.025, 245),
      mutedForeground: oklch(0.72, 0.03, 235),
      accent: oklch(0.3, 0.04, 235),
      accentForeground: oklch(0.95, 0.01, 230),
      border: oklch(0.31, 0.028, 245),
      ring: oklch(0.6, 0.08, 235),
      sidebar: oklch(0.19, 0.022, 248)
    }
  ),
  preset(
    'forest',
    {
      background: oklch(0.98, 0.008, 150),
      foreground: oklch(0.24, 0.03, 160),
      card: oklch(0.99, 0.005, 150),
      primary: oklch(0.45, 0.11, 155),
      primaryForeground: oklch(0.985, 0, 0),
      muted: oklch(0.94, 0.015, 150),
      mutedForeground: oklch(0.47, 0.03, 155),
      accent: oklch(0.91, 0.03, 150),
      accentForeground: oklch(0.28, 0.04, 160),
      border: oklch(0.885, 0.02, 150),
      ring: oklch(0.52, 0.08, 155),
      sidebar: oklch(0.955, 0.012, 150)
    },
    {
      background: oklch(0.17, 0.02, 160),
      foreground: oklch(0.94, 0.015, 150),
      card: oklch(0.21, 0.025, 158),
      primary: oklch(0.72, 0.13, 155),
      primaryForeground: oklch(0.17, 0.02, 160),
      muted: oklch(0.25, 0.02, 158),
      mutedForeground: oklch(0.7, 0.03, 155),
      accent: oklch(0.29, 0.035, 155),
      accentForeground: oklch(0.94, 0.015, 150),
      border: oklch(0.3, 0.022, 158),
      ring: oklch(0.58, 0.09, 155),
      sidebar: oklch(0.19, 0.022, 160)
    }
  ),
  preset(
    'sunset',
    {
      background: oklch(0.985, 0.01, 90),
      foreground: oklch(0.28, 0.03, 60),
      card: oklch(0.995, 0.006, 90),
      primary: oklch(0.55, 0.15, 55),
      primaryForeground: oklch(0.985, 0, 0),
      muted: oklch(0.94, 0.02, 85),
      mutedForeground: oklch(0.5, 0.03, 65),
      accent: oklch(0.91, 0.035, 80),
      accentForeground: oklch(0.32, 0.04, 60),
      border: oklch(0.89, 0.02, 85),
      ring: oklch(0.6, 0.1, 60),
      sidebar: oklch(0.96, 0.015, 88)
    },
    {
      background: oklch(0.18, 0.015, 70),
      foreground: oklch(0.94, 0.02, 85),
      card: oklch(0.22, 0.02, 70),
      primary: oklch(0.78, 0.14, 75),
      primaryForeground: oklch(0.2, 0.02, 70),
      muted: oklch(0.27, 0.02, 70),
      mutedForeground: oklch(0.72, 0.03, 70),
      accent: oklch(0.31, 0.03, 70),
      accentForeground: oklch(0.94, 0.02, 85),
      border: oklch(0.32, 0.02, 70),
      ring: oklch(0.65, 0.09, 70),
      sidebar: oklch(0.2, 0.018, 70)
    }
  ),
  preset(
    'rose',
    {
      background: oklch(0.985, 0.006, 355),
      foreground: oklch(0.25, 0.02, 350),
      card: oklch(0.995, 0.004, 355),
      primary: oklch(0.52, 0.16, 355),
      primaryForeground: oklch(0.985, 0, 0),
      muted: oklch(0.945, 0.01, 355),
      mutedForeground: oklch(0.49, 0.03, 350),
      accent: oklch(0.92, 0.025, 355),
      accentForeground: oklch(0.3, 0.03, 350),
      border: oklch(0.9, 0.015, 355),
      ring: oklch(0.56, 0.1, 355),
      sidebar: oklch(0.96, 0.01, 355)
    },
    {
      background: oklch(0.18, 0.012, 350),
      foreground: oklch(0.94, 0.012, 355),
      card: oklch(0.22, 0.015, 350),
      primary: oklch(0.75, 0.13, 355),
      primaryForeground: oklch(0.2, 0.015, 350),
      muted: oklch(0.27, 0.015, 350),
      mutedForeground: oklch(0.72, 0.03, 350),
      accent: oklch(0.31, 0.025, 350),
      accentForeground: oklch(0.94, 0.012, 355),
      border: oklch(0.32, 0.015, 350),
      ring: oklch(0.62, 0.09, 355),
      sidebar: oklch(0.2, 0.014, 350)
    }
  ),
  preset(
    'midnight',
    {
      background: oklch(0.975, 0.008, 290),
      foreground: oklch(0.22, 0.03, 285),
      card: oklch(0.99, 0.005, 290),
      primary: oklch(0.45, 0.18, 285),
      primaryForeground: oklch(0.985, 0, 0),
      muted: oklch(0.93, 0.015, 290),
      mutedForeground: oklch(0.48, 0.03, 285),
      accent: oklch(0.9, 0.03, 290),
      accentForeground: oklch(0.28, 0.04, 285),
      border: oklch(0.875, 0.015, 290),
      ring: oklch(0.52, 0.12, 285),
      sidebar: oklch(0.945, 0.012, 290)
    },
    {
      background: oklch(0.11, 0.015, 285),
      foreground: oklch(0.95, 0.01, 285),
      card: oklch(0.15, 0.02, 285),
      primary: oklch(0.72, 0.17, 285),
      primaryForeground: oklch(0.13, 0.02, 285),
      muted: oklch(0.2, 0.02, 285),
      mutedForeground: oklch(0.68, 0.03, 285),
      accent: oklch(0.24, 0.03, 285),
      accentForeground: oklch(0.95, 0.01, 285),
      border: oklch(0.25, 0.02, 285),
      ring: oklch(0.55, 0.12, 285),
      sidebar: oklch(0.13, 0.018, 285)
    }
  )
]

export const DEFAULT_THEME = 'default'
