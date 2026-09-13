// Per-account display metadata: the small color dot that distinguishes
// accounts in the switcher and settings. Colors are hues into the same
// oklch swatch style the accent picker uses.

import { ACCOUNT_HUES } from '$lib/constants'

// Deterministic hue from the jid so accounts are distinguishable before
// the user ever picks a color.
export function autoHue(jid: string, palette: readonly number[] = ACCOUNT_HUES): number {
  let hash = 0
  for (const char of jid) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palette[hash % palette.length] ?? 210
}

// The hue a badge should show: the user's pick when set, else the jid
// hash.
export function effectiveHue(meta: { hue?: number | undefined } | undefined, jid: string): number {
  return meta?.hue ?? autoHue(jid)
}

// Cycle used by the color button: auto -> each palette hue -> auto.
// Returns undefined for auto.
export function nextAccountHue(
  current: number | undefined,
  palette: readonly number[] = ACCOUNT_HUES
): number | undefined {
  if (current === undefined) return palette[0]
  const index = palette.indexOf(current)
  const next = index === -1 ? 0 : index + 1
  return next >= palette.length ? undefined : palette[next]
}
