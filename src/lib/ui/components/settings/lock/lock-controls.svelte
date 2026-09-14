<script lang="ts">
  import { Lock } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { appLock } from '$lib/state/app/lock/lock.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Input } from '$lib/ui/primitives/input'

  type Mode = 'enable' | 'change' | 'disable'

  let mode = $state<Mode | null>(null)
  let current = $state('')
  let next = $state('')
  let confirm = $state('')
  let error = $state('')
  let busy = $state(false)

  const PASS_MIN = 8
  const autoLockOptions = $derived<[number, string][]>([
    [0, $LL.off()],
    [5, $LL.autoLockMinutes({ minutes: 5 })],
    [15, $LL.autoLockMinutes({ minutes: 15 })],
    [60, $LL.autoLockMinutes({ minutes: 60 })]
  ])

  function open(m: Mode): void {
    mode = m
    current = ''
    next = ''
    confirm = ''
    error = ''
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    error = ''
    if (mode === 'enable' || mode === 'change') {
      if (next.length < PASS_MIN) {
        error = $LL.passphraseShort({ min: PASS_MIN })
        return
      }
      if (next !== confirm) {
        error = $LL.passphraseMismatch()
        return
      }
    }
    busy = true
    try {
      if (mode === 'enable') {
        await appLock.enable(next)
      } else if (mode === 'change') {
        if (!(await appLock.changePassphrase(current, next))) {
          error = $LL.passphraseWrong()
          return
        }
      } else {
        await appLock.disable()
      }
      mode = null
    } catch (cause) {
      console.error('app lock operation failed:', cause)
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center justify-between gap-4 text-sm">
    <span class="flex items-center gap-1.5">
      <Lock class="text-muted-foreground size-4" aria-hidden="true" />
      {$LL.appLock()}
    </span>
    {#if appLock.enabled}
      <div class="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={() => {
            appLock.seal()
            window.location.reload()
          }}
        >
          {$LL.lockNow()}
        </Button>
        <Button type="button" variant="outline" size="sm" onclick={() => open('change')}>
          {$LL.changePassphrase()}
        </Button>
        <Button type="button" variant="outline" size="sm" onclick={() => open('disable')}>
          {$LL.disableLock()}
        </Button>
      </div>
    {:else}
      <Button type="button" variant="outline" size="sm" onclick={() => open('enable')}>
        {$LL.setPassphrase()}
      </Button>
    {/if}
  </div>
  <p class="text-muted-foreground text-xs">{$LL.appLockHint()}</p>

  {#if appLock.enabled}
    <div class="flex items-center justify-between gap-4 text-sm">
      <span>{$LL.autoLock()}</span>
      <div class="flex gap-1 rounded-lg border p-1" role="radiogroup" aria-label={$LL.autoLock()}>
        {#each autoLockOptions as [value, label] (value)}
          {@const selected = settings.current.lockAfterMinutes === value}
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            class="cursor-pointer rounded-md px-2 py-1 text-xs {selected
              ? 'bg-accent'
              : 'hover:bg-accent/50'}"
            onclick={() => settings.set('lockAfterMinutes', value)}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<Dialog
  open={mode !== null}
  onOpenChange={(open) => {
    if (!open) mode = null
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>
        {mode === 'enable'
          ? $LL.setPassphrase()
          : mode === 'change'
            ? $LL.changePassphrase()
            : $LL.disableLock()}
      </DialogTitle>
      <DialogDescription>
        {mode === 'disable' ? $LL.disableLockHint() : $LL.appLockDialogHint()}
      </DialogDescription>
    </DialogHeader>
    <form onsubmit={submit} class="flex flex-col gap-4">
      {#if mode === 'change'}
        <div class="grid gap-1.5">
          <label for="lock-current" class="text-sm font-medium">{$LL.passphraseCurrent()}</label>
          <Input id="lock-current" type="password" bind:value={current} autocomplete="off" />
        </div>
      {/if}
      {#if mode !== 'disable'}
        <div class="grid gap-1.5">
          <label for="lock-next" class="text-sm font-medium">
            {mode === 'change' ? $LL.passphraseNew() : $LL.passphrase()}
          </label>
          <Input id="lock-next" type="password" bind:value={next} autocomplete="off" />
        </div>
        <div class="grid gap-1.5">
          <label for="lock-confirm" class="text-sm font-medium">{$LL.passphraseConfirm()}</label>
          <Input id="lock-confirm" type="password" bind:value={confirm} autocomplete="off" />
        </div>
      {/if}
      {#if error}
        <p role="alert" class="text-destructive text-sm">{error}</p>
      {/if}
      <Button type="submit" disabled={busy}>
        {mode === 'enable'
          ? $LL.setPassphrase()
          : mode === 'change'
            ? $LL.changePassphrase()
            : $LL.disableLock()}
      </Button>
    </form>
  </DialogContent>
</Dialog>
