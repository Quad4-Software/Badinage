<script lang="ts">
  import { toggleMode } from 'mode-watcher'
  import { useEventListener } from 'runed'

  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { eventMatchesCombo } from '$lib/utils/keymap'

  const actions: Record<string, () => void> = {
    'app.settings': () => (app.settingsOpen = !app.settingsOpen),
    'app.commandPalette': () => (app.paletteOpen = !app.paletteOpen),
    'app.toggleTheme': toggleMode,
    'nav.nextConversation': () => app.cycleConversation(1),
    'nav.prevConversation': () => app.cycleConversation(-1),
    'nav.closeConversation': () => (app.activePeer = null),
    'nav.toggleSidebar': () => app.dispatch('nav.toggleSidebar'),
    'chat.focusComposer': () => app.focusComposer(app.activePeer)
  }

  for (let i = 1; i <= 3; i++) {
    actions[`account.${i}`] = () => {
      const account = accounts.list[i - 1]
      if (account) accounts.activeJid = account.jid
    }
  }

  function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return (
      target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
  }

  useEventListener(
    () => window,
    'keydown',
    (event: KeyboardEvent) => {
      if (isEditable(event.target) && event.key !== 'Escape') return
      // let open dialogs/pickers consume Escape themselves
      if (event.key === 'Escape' && document.querySelector('[role="dialog"]')) return
      const bindings = settings.keybindings
      for (const [id, handler] of Object.entries(actions)) {
        const binding = bindings[id]
        if (binding && eventMatchesCombo(event, binding)) {
          event.preventDefault()
          handler()
          return
        }
      }
    }
  )
</script>
