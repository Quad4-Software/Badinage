// Extension contribution registries beyond menus: slash commands
// dispatched from the composer, declarative settings fields rendered
// in a configure dialog, and message decorations cached per message
// id. Contributions are keyed by extension id and dropped on disable.

import { SvelteMap } from 'svelte/reactivity'

import {
  EXT_LIMITS,
  type ExtCommand,
  type ExtDecoration,
  type ExtSettingField
} from '$lib/core/extensions/types'
import { parseDecoration } from '$lib/core/extensions/wire'

// names an extension command may never take: the builtin slash
// vocabulary, including passthroughs like /me and /spoiler
const BUILTIN_COMMANDS = new Set([
  'clear',
  'leave',
  'nick',
  'topic',
  'invite',
  'join',
  'me',
  'spoiler'
])

interface ExtCommandPayload {
  name: string
  args: string
  accountJid: string
  peerJid: string
  kind: string
}

type CommandResult = { handled: true; body?: string } | { handled: false }

// invokes a worker handler and resolves with its return value
type Runner = (itemId: string, payload: unknown) => Promise<unknown>

const DECORATE_INFLIGHT_MAX = 4
const COMMAND_BODY_MAX = 4096

class ExtApiStore {
  // settings fields each enabled extension declared, rendered by the
  // configure dialog
  settingFields = new SvelteMap<string, ExtSettingField[]>()
  // current values per extension, persisted host-side and pushed to
  // the worker on every change
  settingValues = new SvelteMap<string, Record<string, unknown>>()
  // decoration results keyed account|peer|message-id, bounded
  decorations = new SvelteMap<string, ExtDecoration>()

  private commands = new Map<string, { extId: string; run: Runner }>()
  private decorators = new Map<string, Runner>()
  private inflight = new Map<string, number>()
  private pending = new Set<string>()
  private settingsWriters = new Map<string, (key: string, value: unknown) => void>()

  // replace the extension's command set. Builtin names and names
  // already claimed by another extension are refused
  setCommands(extId: string, items: ExtCommand[], run: Runner): void {
    for (const [name, c] of this.commands) {
      if (c.extId === extId) this.commands.delete(name)
    }
    for (const item of items) {
      if (BUILTIN_COMMANDS.has(item.name) || this.commands.has(item.name)) continue
      this.commands.set(item.name, { extId, run })
    }
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name)
  }

  // run an extension slash command. A {body} result becomes a message
  // the caller sends. Anything else just means the command was handled
  async runCommand(name: string, payload: ExtCommandPayload): Promise<CommandResult> {
    const entry = this.commands.get(name)
    if (!entry) return { handled: false }
    const res = await entry.run(`cmd:${name}`, payload)
    const body =
      typeof res === 'object' &&
      res !== null &&
      typeof (res as { body?: unknown }).body === 'string'
        ? (res as { body: string }).body.slice(0, COMMAND_BODY_MAX)
        : undefined
    return body === undefined ? { handled: true } : { handled: true, body }
  }

  setDecorator(extId: string, run: Runner): void {
    this.decorators.set(extId, run)
  }

  // lazily resolve the decoration for one message. Virtualization
  // bounds how many of these run: only mounted rows ask, and each
  // extension is capped on concurrent calls
  async ensureDecoration(key: string, payload: unknown): Promise<void> {
    if (this.decorators.size === 0 || this.decorations.has(key) || this.pending.has(key)) return
    this.pending.add(key)
    try {
      for (const [extId, run] of this.decorators) {
        const inflight = this.inflight.get(extId) ?? 0
        if (inflight >= DECORATE_INFLIGHT_MAX) continue
        this.inflight.set(extId, inflight + 1)
        try {
          const decoration = parseDecoration(await run('decorate', payload))
          if (decoration) {
            if (this.decorations.size >= EXT_LIMITS.decorationsCacheMax) {
              const first = this.decorations.keys().next().value
              if (first) this.decorations.delete(first)
            }
            this.decorations.set(key, decoration)
            break
          }
        } finally {
          this.inflight.set(extId, Math.max(0, (this.inflight.get(extId) ?? 1) - 1))
        }
      }
    } finally {
      this.pending.delete(key)
    }
  }

  setSettings(extId: string, fields: ExtSettingField[], values: Record<string, unknown>): void {
    this.settingFields.set(extId, fields)
    this.settingValues.set(extId, values)
  }

  // persists through the writer the extension store registered, which
  // also pushes the new values into the worker
  setSettingValue(extId: string, key: string, value: unknown): void {
    this.settingValues.set(extId, { ...(this.settingValues.get(extId) ?? {}), [key]: value })
    this.settingsWriters.get(extId)?.(key, value)
  }

  registerSettingsWriter(extId: string, write: (key: string, value: unknown) => void): void {
    this.settingsWriters.set(extId, write)
  }

  clearExtension(extId: string): void {
    for (const [name, c] of this.commands) {
      if (c.extId === extId) this.commands.delete(name)
    }
    this.decorators.delete(extId)
    this.inflight.delete(extId)
    this.settingFields.delete(extId)
    this.settingValues.delete(extId)
    this.settingsWriters.delete(extId)
  }
}

export const extApi = new ExtApiStore()
