<script lang="ts">
  import { RotateCcw } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import {
    DEFAULT_KEYBINDINGS,
    KEYBINDING_ACTIONS,
    settings,
    type KeybindingAction
  } from '$lib/state/settings.svelte'
  import { idb } from '$lib/core/storage/idb'
  import { cn } from '$lib/utils/cn'
  import { comboFromEvent, comboToString, displayCombo } from '$lib/utils/keymap'
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
  } from '$lib/ui/primitives/alert-dialog'
  import { Button, buttonVariants } from '$lib/ui/primitives/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Kbd } from '$lib/ui/primitives/kbd'
  import { Separator } from '$lib/ui/primitives/separator'
  import { Switch } from '$lib/ui/primitives/switch'

  const isMac = navigator.platform.toUpperCase().includes('MAC')

  let capturing = $state<KeybindingAction | null>(null)
  let confirmWipe = $state(false)

  async function wipeData() {
    sessionStorage.clear()
    localStorage.clear()
    if ('indexedDB' in window) {
      await idb.clear('kv')
      await idb.clear('messages')
      await idb.clear('omemo')
    }
    location.reload()
  }

  const ACTION_LABELS: Record<KeybindingAction, () => string> = {
    'app.settings': () => $LL.kbSettings(),
    'app.toggleTheme': () => $LL.kbToggleTheme(),
    'nav.nextConversation': () => $LL.kbNextConversation(),
    'nav.prevConversation': () => $LL.kbPrevConversation(),
    'nav.closeConversation': () => $LL.kbCloseConversation(),
    'chat.focusComposer': () => $LL.kbFocusComposer(),
    'account.1': () => $LL.kbAccount({ n: 1 }),
    'account.2': () => $LL.kbAccount({ n: 2 }),
    'account.3': () => $LL.kbAccount({ n: 3 })
  }

  function captureKey(action: KeybindingAction) {
    capturing = action
  }

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

<Dialog bind:open={app.settingsOpen}>
  <DialogContent class="max-h-[85vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>{$LL.settings()}</DialogTitle>
      <DialogDescription>{$LL.settingsHint()}</DialogDescription>
    </DialogHeader>

    <section class="flex flex-col gap-3" aria-label={$LL.general()}>
      <h3 class="text-sm font-medium">{$LL.general()}</h3>
      <label class="flex items-center justify-between gap-4 text-sm">
        {$LL.sendWithEnter()}
        <Switch
          checked={settings.current.sendWithEnter}
          onCheckedChange={(v) => settings.set('sendWithEnter', v)}
        />
      </label>
      <label class="flex items-center justify-between gap-4 text-sm">
        {$LL.notifications()}
        <Switch
          checked={settings.current.notifications}
          onCheckedChange={(v) => settings.set('notifications', v)}
        />
      </label>
      <label class="flex items-center justify-between gap-4 text-sm">
        {$LL.sounds()}
        <Switch
          checked={settings.current.sounds}
          onCheckedChange={(v) => settings.set('sounds', v)}
        />
      </label>
    </section>

    <Separator />

    <section class="flex flex-col gap-3" aria-label={$LL.keyboard()}>
      <h3 class="text-sm font-medium">{$LL.keyboard()}</h3>
      <p class="text-muted-foreground text-xs">{$LL.keyboardHint()}</p>
      <ul class="flex flex-col">
        {#each KEYBINDING_ACTIONS as action (action)}
          <li class="flex items-center justify-between gap-4 py-1.5">
            <span class="text-sm">{ACTION_LABELS[action]()}</span>
            <span class="flex items-center gap-2">
              {#if capturing === action}
                <Kbd class="animate-pulse">{$LL.pressKeys()}</Kbd>
              {:else}
                <button
                  class="focus-visible:ring-ring cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                  onclick={() => captureKey(action)}
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
    </section>

    <Separator />

    <section class="flex flex-col gap-3" aria-label={$LL.dangerZone()}>
      <h3 class="text-destructive text-sm font-medium">{$LL.dangerZone()}</h3>
      <div class="flex items-center justify-between gap-4">
        <p class="text-muted-foreground text-xs">{$LL.wipeDataHint()}</p>
        <Button variant="destructive" size="sm" onclick={() => (confirmWipe = true)}>
          {$LL.wipeData()}
        </Button>
      </div>
    </section>
  </DialogContent>
</Dialog>

<AlertDialog bind:open={confirmWipe}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{$LL.wipeDataTitle()}</AlertDialogTitle>
      <AlertDialogDescription>{$LL.wipeDataDescription()}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel class={cn(buttonVariants({ variant: 'outline' }))}>
        {$LL.cancel()}
      </AlertDialogCancel>
      <AlertDialogAction class={cn(buttonVariants({ variant: 'destructive' }))} onclick={wipeData}>
        {$LL.wipeData()}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
