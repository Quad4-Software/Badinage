// Settings backup: serialize the persisted blob to a portable JSON file
// and validate an imported file back into a safe settings patch. Both
// sides are pure so the edge cases (junk json, wrong types, unknown
// keys, hostile values) are unit tested. The store injects its defaults
// and keybinding action list so this module stays leaf-level.

import { comboToString, parseCombo } from '../keymap'
import { isThemeId } from '../themes/presets'

const BACKUP_KIND = 'badinage-settings'
const BACKUP_VERSION = 1

const DENSITIES = new Set(['comfortable', 'compact'])
const MODES = new Set(['light', 'dark', 'system'])
const META_KEYS = new Set(['hue', 'notify', 'invisible'])

interface ParsedBackup {
  // only keys that passed validation land here. Dropped counts the
  // entries that failed so callers can warn about partial imports
  settings: Record<string, unknown>
  dropped: number
  mode?: 'light' | 'dark' | 'system'
}

export type ParseResult = { ok: true; backup: ParsedBackup } | { ok: false }

export function buildBackup(settings: Record<string, unknown>, mode?: string): string {
  return JSON.stringify(
    {
      kind: BACKUP_KIND,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      ...(MODES.has(mode ?? '') ? { mode } : {}),
      settings
    },
    null,
    2
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((v): v is string => typeof v === 'string')
}

function validKeybindings(value: unknown, actions: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(value)) return out
  const known = new Set(actions)
  for (const [action, combo] of Object.entries(value)) {
    if (!known.has(action) || typeof combo !== 'string') continue
    const parsed = parseCombo(combo)
    // normalize synonyms like ctrl+ to the canonical mod+ form. The
    // parser accepts any trailing token as a key, so multi-word strings
    // that could never be an event.key are rejected here
    if (parsed && (parsed.key.length === 1 || !parsed.key.includes(' '))) {
      out[action] = comboToString(parsed)
    }
  }
  return out
}

function validAccountMeta(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!isRecord(value)) return out
  for (const [jid, meta] of Object.entries(value)) {
    if (!isRecord(meta)) continue
    const clean: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(meta)) {
      if (!META_KEYS.has(key)) continue
      if (key === 'hue' && typeof v === 'number' && Number.isFinite(v)) clean.hue = v
      if ((key === 'notify' || key === 'invisible') && typeof v === 'boolean') clean[key] = v
    }
    if (Object.keys(clean).length > 0) out[jid] = clean
  }
  return out
}

// seenPrompts is a record of finite version numbers
function validNumberMap(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!isRecord(value)) return out
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
  }
  return out
}

// validates one settings key against the shape of the defaults blob.
// returns undefined when the value is unusable so the caller drops it
function validValue(
  key: string,
  value: unknown,
  defaults: Record<string, unknown>,
  actions: readonly string[]
): unknown {
  const fallback = defaults[key]
  if (fallback === undefined) return undefined
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : undefined
  if (typeof fallback === 'string') {
    if (typeof value !== 'string') return undefined
    if (key === 'theme') return isThemeId(value) ? value : undefined
    if (key === 'density') return DENSITIES.has(value) ? value : undefined
    return value
  }
  if (typeof fallback === 'number' || fallback === null) {
    // accentHue is the only number-or-null setting
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : value === null
        ? null
        : undefined
  }
  if (Array.isArray(fallback)) return validStrings(value) ?? undefined
  if (key === 'keybindings') return validKeybindings(value, actions)
  if (key === 'accountMeta') return validAccountMeta(value)
  if (key === 'seenPrompts') return validNumberMap(value)
  return isRecord(value) ? value : undefined
}

// accepts the wrapped { kind, settings } envelope and a bare settings
// object alike. Anything else is rejected. Unknown keys are ignored,
// invalid values are dropped, and an import that yields nothing is an
// error rather than a silent no-op.
export function parseBackup(
  text: string,
  defaults: Record<string, unknown>,
  keyActions: readonly string[]
): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false }
  }
  if (!isRecord(raw)) return { ok: false }
  if (raw.kind !== undefined && raw.kind !== BACKUP_KIND) return { ok: false }
  if (typeof raw.version === 'number' && raw.version > BACKUP_VERSION) return { ok: false }
  const source = isRecord(raw.settings) ? raw.settings : raw

  const settings: Record<string, unknown> = {}
  let dropped = 0
  for (const [key, value] of Object.entries(source)) {
    const valid = validValue(key, value, defaults, keyActions)
    if (valid === undefined) dropped++
    else settings[key] = valid
  }
  if (Object.keys(settings).length === 0) return { ok: false }

  const backup: ParsedBackup = { settings, dropped }
  if (typeof raw.mode === 'string' && MODES.has(raw.mode)) {
    backup.mode = raw.mode as 'light' | 'dark' | 'system'
  }
  return { ok: true, backup }
}
