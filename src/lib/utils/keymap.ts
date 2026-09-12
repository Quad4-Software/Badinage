export interface KeyCombo {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function comboFromEvent(event: KeyboardEvent): KeyCombo | null {
  const key = event.key.toLowerCase()
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null
  return {
    mod: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
    key
  }
}

export function comboToString(combo: KeyCombo): string {
  const parts: string[] = []
  if (combo.mod) parts.push('mod')
  if (combo.alt) parts.push('alt')
  if (combo.shift) parts.push('shift')
  parts.push(combo.key)
  return parts.join('+')
}

export function parseCombo(input: string): KeyCombo | null {
  const parts = input.toLowerCase().split('+').filter(Boolean)
  const key = parts.at(-1)
  if (!key || ['mod', 'ctrl', 'alt', 'shift', 'meta'].includes(key)) return null
  const mods = new Set(parts.slice(0, -1))
  for (const part of mods) {
    if (!['mod', 'ctrl', 'alt', 'shift', 'meta'].includes(part)) return null
  }
  return {
    mod: mods.has('mod') || mods.has('ctrl') || mods.has('meta'),
    shift: mods.has('shift'),
    alt: mods.has('alt'),
    key
  }
}

export function displayCombo(input: string, isMac: boolean): string {
  const combo = parseCombo(input)
  if (!combo) return input
  const parts: string[] = []
  if (combo.mod) parts.push(isMac ? 'Cmd' : 'Ctrl')
  if (combo.alt) parts.push(isMac ? 'Opt' : 'Alt')
  if (combo.shift) parts.push('Shift')
  parts.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key)
  return parts.join('+')
}

export function eventMatchesCombo(event: KeyboardEvent, binding: string): boolean {
  const combo = comboFromEvent(event)
  const wanted = parseCombo(binding)
  if (!combo || !wanted) return false
  return (
    combo.key === wanted.key &&
    combo.mod === wanted.mod &&
    combo.shift === wanted.shift &&
    combo.alt === wanted.alt
  )
}
