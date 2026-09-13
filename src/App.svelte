<script lang="ts">
  import { ModeWatcher } from 'mode-watcher'
  import { onMount } from 'svelte'
  import { SvelteURL } from 'svelte/reactivity'
  import { toast } from 'svelte-sonner'

  import { reportError } from '$lib/core/telemetry'
  import { loadLocale } from '$lib/i18n/i18n-util.sync'
  import { setLocale } from '$lib/i18n/i18n-svelte'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts, restoreSessions } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { parseDeepLink, shareInbox } from '$lib/state/links'
  import { settings } from '$lib/state/settings.svelte'
  import AddContactDialog from '$lib/ui/components/dialogs/add-contact-dialog.svelte'
  import ExploreRoomsDialog from '$lib/ui/components/dialogs/explore-rooms-dialog.svelte'
  import JoinRoomDialog from '$lib/ui/components/dialogs/join-room-dialog.svelte'
  import ShareDialog from '$lib/ui/components/dialogs/share-dialog.svelte'
  import SettingsDialog from '$lib/ui/components/settings/settings-dialog.svelte'
  import AppShell from '$lib/ui/components/shell/app-shell.svelte'
  import CommandPalette from '$lib/ui/components/shell/command-palette.svelte'
  import CrashView from '$lib/ui/components/shell/crash-view.svelte'
  import DemoBadge from '$lib/ui/components/shell/demo-badge.svelte'
  import Keyboard from '$lib/ui/components/shell/keyboard.svelte'
  import LoginForm from '$lib/ui/components/shell/login-form.svelte'
  import Notifications from '$lib/ui/components/shell/notifications.svelte'
  import StatusToasts from '$lib/ui/components/shell/status-toasts.svelte'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Sonner } from '$lib/ui/primitives/sonner'
  import { TooltipProvider } from '$lib/ui/primitives/tooltip'
  import { watchIdleAway } from '$lib/ui/idle-away'
  import { normalizeDensity } from '$lib/utils/density'
  import { updatePageMeta } from '$lib/utils/meta'

  $effect(() => {
    const hue = settings.current.accentHue
    const root = document.documentElement
    if (hue === null) {
      root.removeAttribute('data-accent')
      root.style.removeProperty('--accent-h')
    } else {
      root.dataset.accent = 'custom'
      root.style.setProperty('--accent-h', String(hue))
    }
  })

  // density lands as an attribute so the css tokens in app.css can scale
  // spacing and type off it
  $effect(() => {
    document.documentElement.dataset.density = normalizeDensity(settings.current.density)
  })

  onMount(() => {
    loadLocale('en')
    setLocale('en')

    // XEP-0493 callback: the authorization server redirected back here
    // with ?code&state; finish the flow before any session restore so a
    // remembered password login cannot steal the slot
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const oauthError = params.get('error')
    if (code || state || oauthError) {
      // strip the query so a reload cannot replay a spent code
      window.history.replaceState(null, '', window.location.pathname)
      if (code && state) {
        void accounts.completeOAuth(code, state).then((result) => {
          if (!result.ok) toast.error($LL.oauthFailed())
        })
      } else {
        toast.error($LL.oauthFailed())
      }
    } else {
      for (const options of restoreSessions()) {
        void accounts.add(options)
      }
    }
    // demo deployments (github pages) drop visitors straight into demo mode
    if (import.meta.env.VITE_DEMO === '1' && accounts.list.length === 0) {
      void accounts.add({ jid: 'demo@badinage.local', password: 'demo', demo: true })
    }

    // XEP-0147 deep links: the web+xmpp protocol handler (manifest or
    // registerProtocolHandler) lands on ?uri=, the in-app form uses
    // #/xmpp/<encoded-uri>. Either way the parsed action waits in
    // app.pendingLink until an account is ready to act on it.
    const link = parseDeepLink(new SvelteURL(window.location.href), window.location.hash)
    if (link) {
      app.pendingLink = link
      // strip the launch query so reloads do not replay it
      const clean = new SvelteURL(window.location.href)
      clean.searchParams.delete('uri')
      clean.hash = ''
      window.history.replaceState(null, '', clean)
    }
    // a share_target POST parked its payload in IndexedDB before the
    // app booted; the share dialog drains it
    void shareInbox().then((payload) => {
      if (payload) app.sharePayload = payload
    })

    const onError = (event: ErrorEvent) => {
      if (!event.error) return
      toast.error(event.error instanceof Error ? event.error.message : String(event.error))
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      toast.error(event.reason instanceof Error ? event.reason.message : String(event.reason))
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  })

  // Route a pending deep link once an account exists. 'message' resolves
  // straight into the conversation with an optional prefilled draft;
  // 'join' and 'roster' open their dialogs, which consume and clear the
  // pending link themselves.
  $effect(() => {
    const link = app.pendingLink
    if (!link || accounts.list.length === 0) return
    if (link.kind === 'message') {
      app.pendingLink = null
      app.selectPeer(link.jid)
      if (link.body) app.setDraft(link.jid, link.body)
      app.focusComposer(link.jid)
    } else if (link.kind === 'join') {
      app.joinRoomOpen = true
    } else {
      app.addContactOpen = true
    }
  })

  // Badging API + tab title: mirror the total unread count onto the app
  // icon and the document title. Muted conversations still count - the
  // badge is about unread state, not notification policy.
  $effect(() => {
    let total = 0
    for (const store of app.chats.values()) {
      for (const conversation of store.conversations.values()) {
        total += conversation.unread
      }
    }
    updatePageMeta({
      title: total > 0 ? `(${total}) ${$LL.appName()}` : $LL.appName()
    })
    if (!('setAppBadge' in navigator)) return
    if (total > 0) void navigator.setAppBadge(total)
    else void navigator.clearAppBadge()
  })

  // auto-away: flips connected 'online' accounts to 'away' after
  // IDLE_AWAY_MS without input; the next activity restores them
  $effect(() => watchIdleAway())
</script>

<TooltipProvider delayDuration={250}>
  <ModeWatcher />
  <Sonner />
  <Keyboard />
  <StatusToasts />
  <Notifications />
  {#if accounts.active?.options.demo}
    <DemoBadge />
  {/if}
  <SettingsDialog />
  <JoinRoomDialog />
  <AddContactDialog />
  <ExploreRoomsDialog />
  {#if app.sharePayload}
    <ShareDialog
      bind:open={
        () => app.sharePayload !== null,
        (open) => {
          if (!open) app.sharePayload = null
        }
      }
      payload={app.sharePayload}
    />
  {/if}
  <CommandPalette />

  <Dialog bind:open={app.loginOpen}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{$LL.addAccount()}</DialogTitle>
        <DialogDescription>{$LL.signInTitle()}</DialogDescription>
      </DialogHeader>
      <LoginForm embedded />
    </DialogContent>
  </Dialog>

  <svelte:boundary onerror={(error: unknown) => reportError(error, { source: 'crash-boundary' })}>
    {#snippet failed(error: unknown, reset: () => void)}
      <CrashView {error} {reset} />
    {/snippet}

    {#if accounts.list.length === 0}
      <main class="h-full">
        <LoginForm />
      </main>
    {:else}
      <AppShell />
    {/if}
  </svelte:boundary>
</TooltipProvider>
