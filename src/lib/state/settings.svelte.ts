import { PersistedState } from 'runed'

import { globalKey } from '$lib/core/storage/keys'
import { setTelemetryEnabled } from '$lib/core/telemetry'
import { buildBackup, parseBackup, type ParseResult } from '$lib/utils/backup/settings-backup'
import type { Density } from '$lib/utils/density'
import { bareJid } from '$lib/utils/jid'

export const KEYBINDING_ACTIONS = [
  'app.settings',
  'app.toggleTheme',
  'nav.nextConversation',
  'nav.prevConversation',
  'nav.closeConversation',
  'nav.toggleSidebar',
  'chat.focusComposer',
  'app.commandPalette',
  'app.search',
  'account.1',
  'account.2',
  'account.3'
] as const

export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number]

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string> = {
  'app.settings': 'mod+,',
  'app.toggleTheme': 'mod+shift+l',
  'nav.nextConversation': 'alt+arrowdown',
  'nav.prevConversation': 'alt+arrowup',
  'nav.closeConversation': 'escape',
  'nav.toggleSidebar': 'mod+b',
  'chat.focusComposer': 'alt+c',
  'app.commandPalette': 'mod+k',
  'app.search': 'mod+f',
  'account.1': 'mod+1',
  'account.2': 'mod+2',
  'account.3': 'mod+3'
}

// per-account display and alert preferences, keyed by bare jid
interface AccountMeta {
  // pinned accent hue for the account badge; unset picks from the jid
  hue?: number | undefined
  // per-account desktop notifications; unset follows the global toggle
  notify?: boolean | undefined
  // XEP-0186: the account is in invisible mode; reapplied on connect
  invisible?: boolean | undefined
}

interface Settings {
  keybindings: Record<string, string>
  sendWithEnter: boolean
  notifications: boolean
  sounds: boolean
  // privacy: whether we announce typing, receipts and read markers
  sendChatStates: boolean
  sendReceipts: boolean
  sendReadMarkers: boolean
  // omemo: trust newly seen device fingerprints automatically (BTBV)
  omemoBlindTrust: boolean
  // opt-in crash reporting to the bundled or deployment-configured
  // sentry-compatible endpoint; off until the user explicitly enables it
  crashReporting: boolean
  // oklch hue for the accent color; null keeps the theme default
  accentHue: number | null
  // ui density, applied as data-density on the root element
  density: Density
  // preferred account ordering for the switcher; jids not listed keep
  // their arrival order at the end
  accountOrder: string[]
  accountMeta: Record<string, AccountMeta>
  // XEP-0301: stream the dm draft to the peer while typing. Opt-in: it
  // shares keystroke-level timing, so the default stays off.
  sendRealTimeText: boolean
  // XEP-0224: allow contacts to nudge us with an attention request
  allowAttention: boolean
  // XEP-0080: fetch map tiles for shared locations; off keeps the
  // location card link-only so nothing off-origin is requested
  mapPreviews: boolean
  // register the web+xmpp protocol handler at runtime (the manifest
  // entry covers installed PWAs regardless of this toggle)
  xmppLinkHandler: boolean
  // flip presence to away after IDLE_AWAY_MS without input, and back on
  // the next keystroke or pointer event
  autoAway: boolean
  // named palette preset; 'default' keeps the stylesheet tokens
  theme: string
  // settings section ids the user collapsed; persists across sessions
  collapsedSections: string[]
  // one-time prompt id -> the version last answered; bumping a prompt's
  // version re-asks users who answered an earlier one
  seenPrompts: Record<string, number>
}

const DEFAULT_SETTINGS: Settings = {
  keybindings: { ...DEFAULT_KEYBINDINGS },
  sendWithEnter: true,
  notifications: true,
  sounds: false,
  sendChatStates: true,
  sendReceipts: true,
  sendReadMarkers: true,
  omemoBlindTrust: true,
  crashReporting: false,
  accentHue: null,
  density: 'comfortable',
  accountOrder: [],
  accountMeta: {},
  sendRealTimeText: false,
  allowAttention: true,
  mapPreviews: false,
  xmppLinkHandler: false,
  autoAway: true,
  theme: 'default',
  collapsedSections: [],
  seenPrompts: {}
}

class SettingsStore {
  private persisted = new PersistedState<Settings>(globalKey('settings'), DEFAULT_SETTINGS)

  get current(): Settings {
    // merge defaults so keys added later are never undefined for users
    // with an older persisted blob
    return { ...DEFAULT_SETTINGS, ...this.persisted.current }
  }

  get keybindings(): Record<string, string> {
    return { ...DEFAULT_KEYBINDINGS, ...this.persisted.current.keybindings }
  }

  setBinding(action: KeybindingAction, combo: string): void {
    this.persisted.current = {
      ...this.persisted.current,
      keybindings: { ...this.persisted.current.keybindings, [action]: combo }
    }
  }

  resetBinding(action: KeybindingAction): void {
    const { [action]: _removed, ...keybindings } = this.persisted.current.keybindings
    void _removed
    this.persisted.current = { ...this.persisted.current, keybindings }
  }

  metaFor(jid: string): AccountMeta {
    return this.current.accountMeta[bareJid(jid)] ?? {}
  }

  setAccountMeta(jid: string, patch: AccountMeta): void {
    const bare = bareJid(jid)
    // merge against the defaulted view: older persisted blobs may not
    // carry accountMeta yet
    const meta = this.current.accountMeta
    this.persisted.current = {
      ...this.persisted.current,
      accountMeta: { ...meta, [bare]: { ...meta[bare], ...patch } }
    }
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.persisted.current = { ...this.persisted.current, [key]: value }
    // keep the telemetry opt-in in sync with the toggle
    if (key === 'crashReporting') setTelemetryEnabled(value === true)
  }

  toggleCollapsed(id: string): void {
    const list = this.current.collapsedSections
    this.set('collapsedSections', list.includes(id) ? list.filter((s) => s !== id) : [...list, id])
  }

  resetToDefaults(): void {
    // fresh nested objects so the defaults blob is never aliased
    this.persisted.current = {
      ...DEFAULT_SETTINGS,
      keybindings: { ...DEFAULT_KEYBINDINGS },
      accountOrder: [],
      accountMeta: {},
      collapsedSections: [],
      seenPrompts: {}
    }
    setTelemetryEnabled(DEFAULT_SETTINGS.crashReporting)
  }

  markPromptSeen(id: string, version: number): void {
    this.persisted.current = {
      ...this.persisted.current,
      seenPrompts: { ...this.current.seenPrompts, [id]: version }
    }
  }

  exportBackup(mode?: string): string {
    return buildBackup({ ...this.current }, mode)
  }

  // applies a validated backup file; returns the parse result so the
  // caller can toast success, partial imports, or failure
  importBackup(text: string): ParseResult {
    const defaults: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    const result = parseBackup(text, defaults, KEYBINDING_ACTIONS)
    if (!result.ok) return result
    const patch = result.backup.settings
    // a settings file is not consent: crash reporting keeps its
    // on-device state and only changes through the toggle or the ask
    delete patch.crashReporting
    this.persisted.current = { ...this.current, ...patch }
    return result
  }
}

export const settings = new SettingsStore()
