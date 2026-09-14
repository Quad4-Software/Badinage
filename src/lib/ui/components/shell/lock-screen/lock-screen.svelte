<script lang="ts">
  import { LoaderCircle, Lock } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { appLock } from '$lib/state/app/lock/lock.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'

  let passphrase = $state('')
  let submitting = $state(false)
  let failed = $state(false)

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (submitting || !passphrase) return
    submitting = true
    failed = false
    try {
      failed = !(await appLock.unlock(passphrase))
      if (failed) passphrase = ''
    } finally {
      submitting = false
    }
  }
</script>

<main class="grid h-full place-items-center p-4">
  <form
    onsubmit={submit}
    class="bg-card flex w-full max-w-sm flex-col gap-5 rounded-lg border p-6 shadow-sm"
  >
    <div class="flex flex-col items-center gap-2 text-center">
      <Lock class="text-muted-foreground size-8" aria-hidden="true" />
      <h1 class="text-xl font-semibold">{$LL.appName()}</h1>
      <p class="text-muted-foreground text-sm">{$LL.lockScreenHint()}</p>
    </div>

    <div class="grid gap-1.5">
      <label for="lock-passphrase" class="text-sm font-medium">{$LL.passphrase()}</label>
      <Input
        id="lock-passphrase"
        type="password"
        bind:value={passphrase}
        autocomplete="current-password"
        autofocus
      />
    </div>

    {#if failed}
      <p role="alert" class="text-destructive text-sm">{$LL.passphraseWrong()}</p>
    {/if}

    <Button type="submit" disabled={submitting || !passphrase}>
      {#if submitting}
        <LoaderCircle class="size-4 animate-spin" />
        {$LL.unlocking()}
      {:else}
        {$LL.unlock()}
      {/if}
    </Button>
  </form>
</main>
