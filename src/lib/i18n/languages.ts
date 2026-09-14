// Language switching helpers shared by the boot path and the rail
// language menu. en is the typesafe-i18n base locale and stays bundled;
// every other dictionary lazy-loads on first pick.

import { setLocale } from '$lib/i18n/i18n-svelte'
import type { Locales } from '$lib/i18n/i18n-types'
import { loadLocaleAsync } from '$lib/i18n/i18n-util.async'

// languages the app ships dictionaries for, labeled by endonym so the
// picker reads the same in every language
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'zh', name: '中文' }
] as const

// narrow a persisted string to a locale we actually ship
export function asLocale(code: string): Locales | undefined {
  return LANGUAGES.some((l) => l.code === code) ? (code as Locales) : undefined
}

// fetch the dictionary on demand then flip the reactive locale
export async function applyLocale(code: string): Promise<void> {
  const locale = asLocale(code)
  if (!locale) return
  await loadLocaleAsync(locale)
  setLocale(locale)
}
