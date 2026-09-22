<script lang="ts">
  import { LOGIN_STATUS_POLL_MS } from '$lib/constants'
  import { isValidIrcNick } from '$lib/utils/irc'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts, loginBackoffRemaining, type AccountOptions } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { isValidAnonymousDomain, isValidUserJid } from '$lib/utils/jid'
  import { isWebSocketUrl } from '$lib/utils/url'
  import { Button } from '$lib/ui/primitives/button'
  import { Checkbox } from '$lib/ui/primitives/checkbox'
  import { LoaderCircle } from '@lucide/svelte'

  import { demoLogin, ircJid, registerError, ssoLogin } from './login-form/actions'
  import LoginFields from './login-form/fields.svelte'
  import ThemeToggle from './theme-toggle.svelte'

  let { embedded = false }: { embedded?: boolean } = $props()

  // the jid for xmpp, the nickname for irc, the domain for anonymous
  let identity = $state('')
  let password = $state('')
  let server = $state('')
  let remember = $state(false)
  let untrusted = $state(false)
  let submitting = $state(false)
  let error = $state('')
  // login: sign in to an existing account. register: XEP-0077 creates the
  // account on the server first, then the same connect flow runs
  let mode = $state<'login' | 'register'>('login')
  // SASL ANONYMOUS: identity is just the domain and no password applies.
  // Always treated as untrusted since the identity is disposable anyway
  let anonymous = $state(false)
  // irc only: the password slot carries an oauth bearer token and sasl
  // runs OAUTHBEARER instead of PLAIN
  let useToken = $state(false)
  // authfail backoff: the timestamp the jid may retry at, ticked down by
  // the interval below so the countdown text stays live
  let cooldownUntil = $state(0)
  let now = $state(Date.now())

  // no protocol picker: an @-less identity plus a websocket server url is
  // an irc login, anything else is xmpp. The anonymous checkbox pins the
  // xmpp reading so a bare domain plus a ws endpoint still works
  const isIrc = $derived(!anonymous && !identity.includes('@') && isWebSocketUrl(server.trim()))
  const identityValid = $derived(
    isIrc
      ? isValidIrcNick(identity)
      : anonymous
        ? isValidAnonymousDomain(identity)
        : isValidUserJid(identity)
  )
  const serverValid = $derived(!isIrc || isWebSocketUrl(server))
  const title = $derived(
    mode === 'register' ? $LL.registerTitle() : isIrc ? $LL.signInTitleIrc() : $LL.signInTitle()
  )
  const cooldownLeft = $derived(Math.ceil(Math.max(0, cooldownUntil - now) / 1000))

  // registration is xmpp-only: falling back to login keeps a stray
  // register mode from running on an irc-looking input
  $effect(() => {
    if (isIrc) mode = 'login'
  })

  $effect(() => {
    if (cooldownUntil <= Date.now()) return
    const timer = setInterval(() => (now = Date.now()), 250)
    return () => clearInterval(timer)
  })

  async function startDemo() {
    submitting = true
    await demoLogin()
    submitting = false
  }

  async function startSso() {
    error = ''
    submitting = true
    const failure = await ssoLogin(identity, server, remember, untrusted)
    if (failure === null) return
    submitting = false
    error = failure
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    error = ''
    const loginJid = isIrc ? ircJid(identity, server) : identity
    const wait = loginBackoffRemaining(loginJid)
    if (wait > 0) {
      cooldownUntil = Date.now() + wait
      return
    }
    submitting = true
    // remember stays in the options so the session layer can prove the
    // untrusted flag wins over it
    const options: AccountOptions = { jid: loginJid, password, remember, untrusted }
    if (anonymous) {
      options.anonymous = true
      options.untrusted = true
      options.password = ''
    }
    if (isIrc) {
      options.protocol = 'irc'
      options.websocketUrl = server
      if (useToken) options.oauth = true
    } else if (server) {
      if (isWebSocketUrl(server)) {
        options.websocketUrl = server
      } else {
        options.boshUrl = server
      }
    }
    if (mode === 'register') {
      // registration runs over websocket only: a bosh url falls through to
      // endpoint discovery on the jid domain
      const result = await accounts.register(identity, password, options.websocketUrl)
      if (!result.ok) {
        submitting = false
        error = registerError(result.reason)
        return
      }
    }
    const account = await accounts.add(options)
    // 'disconnected' is only terminal once a real attempt was observed.
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
        cooldownUntil = Date.now() + loginBackoffRemaining(loginJid)
        accounts.remove(account.jid)
      } else if (started && account.status === 'disconnected') {
        clearInterval(timer)
        submitting = false
        error = $LL.connectionError()
      }
    }, LOGIN_STATUS_POLL_MS)
  }
</script>

{#snippet formBody()}
  {#if embedded}
    <div class="flex flex-col gap-1">
      <h1 class="text-xl font-semibold">{$LL.appName()}</h1>
      <p class="text-muted-foreground text-xs">{$LL.appPronunciation()}</p>
      <p class="text-muted-foreground text-sm">{title}</p>
    </div>
  {:else}
    <p class="text-muted-foreground text-sm">{title}</p>
  {/if}

  <LoginFields
    bind:identity
    bind:password
    bind:server
    bind:anonymous
    bind:useToken
    {isIrc}
    {identityValid}
    {serverValid}
  />

  {#if !anonymous}
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
  {/if}

  {#if error}
    <p role="alert" class="text-destructive text-sm">{error}</p>
  {/if}
  {#if cooldownLeft > 0}
    <p role="alert" class="text-muted-foreground text-sm">
      {$LL.loginBackoffWait({ seconds: cooldownLeft })}
    </p>
  {/if}

  <Button
    type="submit"
    disabled={submitting ||
      !identityValid ||
      !serverValid ||
      (!isIrc && !anonymous && !password) ||
      cooldownLeft > 0}
  >
    {#if submitting}
      <LoaderCircle class="size-4 animate-spin" />
      {mode === 'register' ? $LL.registering() : $LL.connecting()}
    {:else}
      {mode === 'register' ? $LL.register() : $LL.connect()}
    {/if}
  </Button>

  {#if !isIrc && !anonymous}
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
  {/if}

  {#if mode === 'login' && !isIrc && !anonymous}
    <Button
      type="button"
      variant="outline"
      class="w-full"
      disabled={submitting || !identityValid || cooldownLeft > 0}
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
    <div class="border-t pt-3 sm:pt-4">
      <Button type="button" variant="secondary" class="w-full" onclick={startDemo}>
        {$LL.tryDemo()}
      </Button>
      <p class="text-muted-foreground mt-2 text-center text-xs">{$LL.demoHint()}</p>
    </div>
  {/if}
{/snippet}

{#if embedded}
  <form onsubmit={submit} class="flex flex-col gap-4">
    {@render formBody()}
  </form>
{:else}
  <div class="auth-bg relative h-full overflow-y-auto">
    <div class="absolute top-4 right-4 z-10">
      <ThemeToggle />
    </div>
    <div
      class="m-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-4 p-4"
    >
      <div class="flex flex-col items-center gap-1">
        <h1 class="font-pixel text-2xl sm:text-3xl">{$LL.appName()}</h1>
        <p class="text-muted-foreground text-xs">{$LL.appPronunciation()}</p>
      </div>
      <form
        onsubmit={submit}
        class="bg-card flex w-full flex-col gap-4 rounded-lg border p-4 shadow-sm sm:gap-5 sm:p-6"
      >
        {@render formBody()}
      </form>
    </div>
  </div>
{/if}
