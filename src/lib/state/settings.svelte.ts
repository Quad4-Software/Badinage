import { PersistedState } from 'runed'

export const KEYBINDING_ACTIONS = [
  'app.settings',
  'app.toggleTheme',
  'nav.nextConversation',
  'nav.prevConversation',
  'nav.closeConversation',
  'chat.focusComposer',
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
  'chat.focusComposer': 'alt+c',
  'account.1': 'mod+1',
  'account.2': 'mod+2',
  'account.3': 'mod+3'
}

export interface Settings {
  keybindings: Record<string, string>
  sendWithEnter: boolean
  notifications: boolean
  sounds: boolean
  // privacy: whether we announce typing, receipts and read markers
  sendChatStates: boolean
  sendReceipts: boolean
  sendReadMarkers: boolean
}

const DEFAULT_SETTINGS: Settings = {
  keybindings: { ...DEFAULT_KEYBINDINGS },
  sendWithEnter: true,
  notifications: true,
  sounds: false,
  sendChatStates: true,
  sendReceipts: true,
  sendReadMarkers: true
}

class SettingsStore {
  private persisted = new PersistedState<Settings>('badinage:settings', DEFAULT_SETTINGS)

  get current(): Settings {
    return this.persisted.current
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

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.persisted.current = { ...this.persisted.current, [key]: value }
  }
}

export const settings = new SettingsStore()
