// Wire-shape validators for extension announcements. Everything the
// worker posts is untrusted input: these pare it down to known shapes
// and caps before the host stores or renders any of it.

import {
  EXT_LIMITS,
  type ExtCommand,
  type ExtDecoration,
  type ExtMenuItem,
  type ExtSettingField
} from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function text(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined
}

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

export function parseMenuItems(raw: unknown): ExtMenuItem[] {
  if (!Array.isArray(raw)) return []
  const out: ExtMenuItem[] = []
  for (const i of raw) {
    if (!isRecord(i)) continue
    const id = text(i.id, 64)
    const section = text(i.section, 64)
    const label = text(i.label, 80)
    if (!id || !section || !label) continue
    out.push({ id, section, label, ...(i.danger === true ? { danger: true } : {}) })
    if (out.length >= EXT_LIMITS.menuItemsMax) break
  }
  return out
}

// slash command names mirror the built-in grammar: lowercase word,
// no leading slash
export function parseCommands(raw: unknown): ExtCommand[] {
  if (!Array.isArray(raw)) return []
  const out: ExtCommand[] = []
  for (const i of raw) {
    if (!isRecord(i)) continue
    const id = text(i.id, 64)
    const name = text(i.name, 32)
    const description = text(i.description, 120) ?? ''
    if (!id || !name || !NAME_PATTERN.test(name)) continue
    // an extension may not shadow its own names or a builtin twice
    if (out.some((c) => c.name === name)) continue
    out.push({ id, name, description })
    if (out.length >= EXT_LIMITS.commandsMax) break
  }
  return out
}

const FIELD_TYPES = new Set(['text', 'number', 'checkbox', 'select'])

export function parseSettingsFields(raw: unknown): ExtSettingField[] {
  if (!Array.isArray(raw)) return []
  const out: ExtSettingField[] = []
  for (const i of raw) {
    if (!isRecord(i)) continue
    const key = text(i.key, 64)
    const label = text(i.label, 80)
    const type = typeof i.type === 'string' && FIELD_TYPES.has(i.type) ? i.type : undefined
    if (!key || !label || !type || !KEY_PATTERN.test(key)) continue
    const field: ExtSettingField = { key, type: type as ExtSettingField['type'], label }
    if (type === 'select') {
      if (!Array.isArray(i.options)) continue
      const options = i.options
        .map((o) => text(o, 80))
        .filter((o): o is string => o !== undefined)
        .slice(0, EXT_LIMITS.settingOptionsMax)
      if (options.length === 0) continue
      field.options = options
    }
    if (
      typeof i.default === 'string' ||
      typeof i.default === 'number' ||
      typeof i.default === 'boolean'
    ) {
      field.default = i.default
    }
    out.push(field)
    if (out.length >= EXT_LIMITS.settingsFieldsMax) break
  }
  return out
}

// a decorator result: null means no decoration for this message
export function parseDecoration(raw: unknown): ExtDecoration | null {
  if (!isRecord(raw)) return null
  const footer = text(raw.footer, EXT_LIMITS.decorationTextMax)
  const title = text(raw.title, EXT_LIMITS.decorationTextMax)
  if (!footer && !title) return null
  return { ...(footer ? { footer } : {}), ...(title ? { title } : {}) }
}
