// XEP-0466 timer options offered in the chat menu, in seconds. Shared by
// the header tooltip (ephemeralLabel) and the options menu.

import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'

export const EPHEMERAL_OPTIONS: { seconds: number; label: () => string }[] = [
  { seconds: 300, label: () => get(LL).timer5m() },
  { seconds: 3600, label: () => get(LL).timer1h() },
  { seconds: 28800, label: () => get(LL).timer8h() },
  { seconds: 86400, label: () => get(LL).timer1d() },
  { seconds: 604800, label: () => get(LL).timer1w() }
]

export function ephemeralLabel(seconds: number | undefined): string {
  if (!seconds) return get(LL).timerOff()
  return EPHEMERAL_OPTIONS.find((o) => o.seconds === seconds)?.label() ?? `${seconds}s`
}
