<script lang="ts">
  import { LOGIN_STATUS_POLL_MS } from '$lib/constants'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts, loginBackoffRemaining, type AccountOptions } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { isValidUserJid } from '$lib/utils/jid'
  import { isWebSocketUrl } from '$lib/utils/url'
  import { Button } from '$lib/ui/primitives/button'
  import { Checkbox } from '$lib/ui/primitives/checkbox'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'
  import { LoaderCircle } from '@lucide/svelte'

  import ThemeToggle from './theme-toggle.svelte'

  let { embedded = false }: { embedded?: boolean } = $props()

  let jid = $state('')
  let password = $state('')
  let server = $state('')
  let remember = $state(false)
  let untrusted = $state(false)
  let submitting = $state(false)
  let error = $state('')
  // login: sign in to an existing account. register: XEP-0077 creates the
  // account on the server first, then the same connect flow runs
  let mode = $state<'login' | 'register'>('login')
  // authfail backoff: the timestamp the jid may retry at, ticked down by
  // the interval below so the countdown text stays live
  let cooldownUntil = $state(0)
  let now = $state(Date.now())

  const jidValid = $derived(isValidUserJid(jid))
  const cooldownLeft = $derived(Math.ceil(Math.max(0, cooldownUntil - now) / 1000))

  $effect(() => {
    if (cooldownUntil <= Date.now()) return
    const timer = setInterval(() => (now = Date.now()), 250)
    return () => clearInterval(timer)
  })

  function registerError(reason: string): string {
    if (reason === 'unsupported') return $LL.registerUnsupported()
    if (reason === 'conflict') return $LL.registerConflict()
    return $LL.registerFailed()
  }

  async function startDemo() {
    submitting = true
    await accounts.add({
      jid: 'demo@badinage.local',
      password: 'demo',
      demo: true
    })
    submitting = false
  }

  // XEP-0493: probe the server for OAUTHBEARER, then hand the browser
  // to the authorization endpoint. The callback resumes in App.svelte.
  async function startSso() {
    error = ''
    submitting = true
    const result = await accounts.startOAuth(jid, {
      websocketUrl: isWebSocketUrl(server) ? server : undefined,
      redirectUri: `${window.location.origin}/`,
      remember,
      untrusted
    })
    if (result.ok) {
      window.location.assign(result.url)
      return
    }
    submitting = false
    error = result.reason === 'unsupported' ? $LL.oauthUnsupported() : $LL.oauthFailed()
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    const wait = loginBackoffRemaining(jid)
    if (wait > 0) {
      cooldownUntil = Date.now() + wait
      return
    }
    submitting = true
    // remember stays in the options so the session layer can prove the
    // untrusted flag wins over it
    const options: AccountOptions = { jid, password, remember, untrusted }
    if (server) {
      if (isWebSocketUrl(server)) {
        options.websocketUrl = server
      } else {
        options.boshUrl = server
      }
    }
    if (mode === 'register') {
      // registration runs over websocket only: a bosh url falls through to
      // endpoint discovery on the jid domain
      const result = await accounts.register(jid, password, options.websocketUrl)
      if (!result.ok) {
        submitting = false
        error = registerError(result.reason)
        return
      }
    }
    const account = await accounts.add(options)
    // 'disconnected' is only terminal once a real attempt was observed;
    // the account starts out disconnected before the first status lands
    let started = false
    const timer = setInterval(() => {
      if (account.status !== 'disconnected') started = true
      if (account.status === 'connected') {
        clearInterval(timer)
        submitting = false
        app.loginOpen = false
      } else if (account.lastError) {
        clearInterval(timer)
        submitting = false
        error = account.lastError === 'authfail' ? $LL.authFailed() : $LL.connectionError()
        cooldownUntil = Date.now() + loginBackoffRemaining(jid)
        accounts.remove(account.jid)
      } else if (started && account.status === 'disconnected') {
        clearInterval(timer)
        submitting = false
        error = $LL.connectionError()
      }
    }, LOGIN_STATUS_POLL_MS)
  }
</script>

<div
  class={embedded
    ? 'flex flex-col'
    : 'auth-bg relative flex h-full flex-col items-center justify-center gap-6 p-4'}
>
  {#if !embedded}
    <div class="absolute top-4 right-4">
      <ThemeToggle />
    </div>
    <div class="flex flex-col items-center gap-1">
      <h1 class="font-pixel text-3xl">{$LL.appName()}</h1>
      <p class="text-muted-foreground text-xs">{$LL.appPronunciation()}</p>
    </div>
  {/if}
  <form
    onsubmit={submit}
    class={embedded
      ? 'flex flex-col gap-5'
      : 'bg-card flex w-full max-w-sm flex-col gap-5 rounded-lg border p-6 shadow-sm'}
  >
    {#if embedded}
      <div class="flex flex-col gap-1">
        <h1 class="text-xl font-semibold">{$LL.appName()}</h1>
        <p class="text-muted-foreground text-xs">{$LL.appPronunciation()}</p>
        <p class="text-muted-foreground text-sm">
          {mode === 'register' ? $LL.registerTitle() : $LL.signInTitle()}
        </p>
      </div>
    {:else}
      <p class="text-muted-foreground text-sm">
        {mode === 'register' ? $LL.registerTitle() : $LL.signInTitle()}
      </p>
    {/if}

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
      <p class="text-muted-foreground text-xs">{$LL.jidHint()}</p>
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
      <Checkbox id="remember" bind:checked={remember} disabled={untrusted} />
      {$LL.rememberSession()}
    </label>

    <div class="grid gap-1">
      <label class="flex items-center gap-2 text-sm">
        <Checkbox id="untrusted" bind:checked={untrusted} />
        {$LL.sharedDevice()}
      </label>
      {#if untrusted}
        <p class="text-muted-foreground ps-6 text-xs">{$LL.sharedDeviceHint()}</p>
      {/if}
    </div>

    {#if error}
      <p role="alert" class="text-destructive text-sm">{error}</p>
    {/if}
    {#if cooldownLeft > 0}
      <p role="alert" class="text-muted-foreground text-sm">
        {$LL.loginBackoffWait({ seconds: cooldownLeft })}
      </p>
    {/if}

    <Button type="submit" disabled={submitting || !jidValid || !password || cooldownLeft > 0}>
      {#if submitting}
        <LoaderCircle class="size-4 animate-spin" />
        {mode === 'register' ? $LL.registering() : $LL.connecting()}
      {:else}
        {mode === 'register' ? $LL.register() : $LL.connect()}
      {/if}
    </Button>

    <Button
      type="button"
      variant="link"
      class="h-auto min-h-6 p-0"
      onclick={() => {
        mode = mode === 'login' ? 'register' : 'login'
        error = ''
      }}
    >
      {mode === 'login' ? $LL.createAccount() : $LL.signIn()}
    </Button>

    {#if mode === 'login'}
      <Button
        type="button"
        variant="outline"
        class="w-full"
        disabled={submitting || !jidValid || cooldownLeft > 0}
        onclick={startSso}
      >
        {#if submitting}
          <LoaderCircle class="size-4 animate-spin" />
          {$LL.ssoWorking()}
        {:else}
          {$LL.signInSso()}
        {/if}
      </Button>
    {/if}

    {#if !embedded}
      <div class="border-t pt-4">
        <Button type="button" variant="secondary" class="w-full" onclick={startDemo}>
          {$LL.tryDemo()}
        </Button>
        <p class="text-muted-foreground mt-2 text-center text-xs">{$LL.demoHint()}</p>
      </div>
    {/if}
  </form>
</div>
