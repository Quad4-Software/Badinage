<script lang="ts">
  import { RotateCcw } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import {
    DEFAULT_KEYBINDINGS,
    KEYBINDING_ACTIONS,
    settings,
    type KeybindingAction
  } from '$lib/state/settings.svelte'
  import { comboFromEvent, comboToString, displayCombo } from '$lib/utils/keymap'
  import { Button } from '$lib/ui/primitives/button'
  import { Kbd } from '$lib/ui/primitives/kbd'

  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  const isMac = navigator.platform.toUpperCase().includes('MAC')

  let capturing = $state<KeybindingAction | null>(null)

  const ACTION_LABELS: Record<KeybindingAction, () => string> = {
    'app.settings': () => $LL.kbSettings(),
    'app.toggleTheme': () => $LL.kbToggleTheme(),
    'nav.nextConversation': () => $LL.kbNextConversation(),
    'nav.prevConversation': () => $LL.kbPrevConversation(),
    'nav.closeConversation': () => $LL.kbCloseConversation(),
    'nav.toggleSidebar': () => $LL.kbToggleSidebar(),
    'chat.focusComposer': () => $LL.kbFocusComposer(),
    'app.commandPalette': () => $LL.kbCommandPalette(),
    'app.search': () => $LL.kbSearch(),
    'account.1': () => $LL.kbAccount({ n: 1 }),
    'account.2': () => $LL.kbAccount({ n: 2 }),
    'account.3': () => $LL.kbAccount({ n: 3 })
  }

  const items = $derived(
    KEYBINDING_ACTIONS.filter((action) =>
      matchesQuery(
        q,
        ACTION_LABELS[action](),
        $LL.keyboard(),
        $LL.keyboardHint(),
        'shortcuts hotkeys'
      )
    )
  )

  $effect(() => {
    settingsSearch.hits.keyboard = items.length
    return () => {
      delete settingsSearch.hits.keyboard
    }
  })

  function onCaptureKeydown(event: KeyboardEvent) {
    if (!capturing) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      capturing = null
      return
    }
    const combo = comboFromEvent(event)
    if (!combo) return
    settings.setBinding(capturing, comboToString(combo))
    capturing = null
  }

  function isDefault(action: KeybindingAction): boolean {
    return (settings.keybindings[action] ?? '') === DEFAULT_KEYBINDINGS[action]
  }
</script>

<svelte:window onkeydown={onCaptureKeydown} />

<SettingSection
  id="keyboard"
  title={$LL.keyboard()}
  forceOpen={q !== ''}
  visible={items.length > 0}
>
  <p class="text-muted-foreground text-xs">{$LL.keyboardHint()}</p>
  <ul class="flex flex-col">
    {#each items as action (action)}
      <li class="flex items-center justify-between gap-4 py-1.5">
        <span class="text-sm">{ACTION_LABELS[action]()}</span>
        <span class="flex items-center gap-2">
          {#if capturing === action}
            <Kbd class="animate-pulse">{$LL.pressKeys()}</Kbd>
          {:else}
            <button
              class="focus-visible:ring-ring cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:outline-none"
              onclick={() => (capturing = action)}
              aria-label={$LL.rebindFor({ action: ACTION_LABELS[action]() })}
            >
              <Kbd>{displayCombo(settings.keybindings[action] ?? '', isMac)}</Kbd>
            </button>
          {/if}
          {#if !isDefault(action)}
            <Button
              variant="ghost"
              size="icon"
              class="size-6"
              onclick={() => settings.resetBinding(action)}
              aria-label={$LL.resetBinding()}
            >
              <RotateCcw class="size-3" />
            </Button>
          {/if}
        </span>
      </li>
    {/each}
  </ul>
</SettingSection>
