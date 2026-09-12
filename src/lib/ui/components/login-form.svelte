<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts, type AccountOptions } from '$lib/state/accounts.svelte'
  import { isValidUserJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'
  import { Checkbox } from '$lib/ui/primitives/checkbox'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'
  import { LoaderCircle } from '@lucide/svelte'

  let { embedded = false }: { embedded?: boolean } = $props()

  let jid = $state('')
  let password = $state('')
  let server = $state('')
  let remember = $state(false)
  let submitting = $state(false)
  let error = $state('')

  const jidValid = $derived(isValidUserJid(jid))

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    submitting = true
    const options: AccountOptions = { jid, password, remember }
    if (server) {
      if (server.startsWith('wss://') || server.startsWith('ws://')) {
        options.websocketUrl = server
      } else {
        options.boshUrl = server
      }
    }
    const account = await accounts.add(options)
    const timer = setInterval(() => {
      if (
        account.status === 'connected' ||
        account.status === 'authfail' ||
        account.status === 'error'
      ) {
        clearInterval(timer)
        submitting = false
        if (account.status === 'authfail') {
          error = $LL.authFailed()
          accounts.remove(account.jid)
        } else if (account.status === 'error') {
          error = $LL.connectionError()
          accounts.remove(account.jid)
        }
      }
    }, 250)
  }
</script>

<div class={embedded ? 'flex flex-col' : 'flex h-full items-center justify-center p-4'}>
  <form
    onsubmit={submit}
    class={embedded
      ? 'flex flex-col gap-5'
      : 'bg-card flex w-full max-w-sm flex-col gap-5 rounded-lg border p-6 shadow-sm'}
  >
    <div class="flex flex-col gap-1">
      <h1 class="text-xl font-semibold">{$LL.appName()}</h1>
      <p class="text-muted-foreground text-sm">{$LL.signInTitle()}</p>
    </div>

    <div class="grid gap-2">
      <Label for="jid">{$LL.jid()}</Label>
      <Input
        id="jid"
        name="jid"
        type="text"
        bind:value={jid}
        placeholder={$LL.jidPlaceholder()}
        autocomplete="username"
        aria-invalid={jid.length > 0 && !jidValid}
        required
      />
    </div>

    <div class="grid gap-2">
      <Label for="password">{$LL.password()}</Label>
      <Input
        id="password"
        name="password"
        type="password"
        bind:value={password}
        autocomplete="current-password"
        required
      />
    </div>

    <div class="grid gap-2">
      <Label for="server">{$LL.server()}</Label>
      <Input
        id="server"
        name="server"
        type="url"
        bind:value={server}
        placeholder={$LL.serverPlaceholder()}
      />
      <p class="text-muted-foreground text-xs">{$LL.serverHint()}</p>
    </div>

    <label class="flex items-center gap-2 text-sm">
      <Checkbox id="remember" bind:checked={remember} />
      {$LL.rememberSession()}
    </label>

    {#if error}
      <p role="alert" class="text-destructive text-sm">{error}</p>
    {/if}

    <Button type="submit" disabled={submitting || !jidValid || !password}>
      {#if submitting}
        <LoaderCircle class="size-4 animate-spin" />
        {$LL.connecting()}
      {:else}
        {$LL.connect()}
      {/if}
    </Button>
  </form>
</div>
