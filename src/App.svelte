<script lang="ts">
  import { ModeWatcher } from 'mode-watcher'
  import { onMount } from 'svelte'
  import { toast } from 'svelte-sonner'

  import { loadLocale } from '$lib/i18n/i18n-util.sync'
  import { setLocale } from '$lib/i18n/i18n-svelte'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts, restoreSessions } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import AddContactDialog from '$lib/ui/components/add-contact-dialog.svelte'
  import AppShell from '$lib/ui/components/app-shell.svelte'
  import CrashView from '$lib/ui/components/crash-view.svelte'
  import JoinRoomDialog from '$lib/ui/components/join-room-dialog.svelte'
  import Keyboard from '$lib/ui/components/keyboard.svelte'
  import LoginForm from '$lib/ui/components/login-form.svelte'
  import SettingsDialog from '$lib/ui/components/settings-dialog.svelte'
  import StatusToasts from '$lib/ui/components/status-toasts.svelte'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Sonner } from '$lib/ui/primitives/sonner'

  onMount(() => {
    loadLocale('en')
    setLocale('en')
    for (const options of restoreSessions()) {
      void accounts.add(options)
    }
    // demo deployments (github pages) drop visitors straight into demo mode
    if (import.meta.env.VITE_DEMO === '1' && accounts.list.length === 0) {
      void accounts.add({ jid: 'demo@badinage.local', password: 'demo', demo: true })
    }

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
</script>

<ModeWatcher />
<Sonner />
<Keyboard />
<StatusToasts />
<SettingsDialog />
<JoinRoomDialog />
<AddContactDialog />

<Dialog bind:open={app.loginOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.addAccount()}</DialogTitle>
      <DialogDescription>{$LL.signInTitle()}</DialogDescription>
    </DialogHeader>
    <LoginForm embedded />
  </DialogContent>
</Dialog>

<svelte:boundary>
  {#snippet failed(error, reset)}
    <CrashView {error} {reset} />
  {/snippet}

  <main class="h-full">
    {#if accounts.list.length === 0}
      <LoginForm />
    {:else}
      <AppShell />
    {/if}
  </main>
</svelte:boundary>
