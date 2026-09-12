<script lang="ts">
  import { ModeWatcher } from 'mode-watcher'
  import { onMount } from 'svelte'

  import { accounts, restoreSessions } from '$lib/state/accounts.svelte'
  import AppShell from '$lib/ui/components/app-shell.svelte'
  import LoginForm from '$lib/ui/components/login-form.svelte'
  import { loadLocale } from '$lib/i18n/i18n-util.sync'
  import { setLocale } from '$lib/i18n/i18n-svelte'

  onMount(() => {
    loadLocale('en')
    setLocale('en')
    for (const options of restoreSessions()) {
      void accounts.add(options)
    }
  })
</script>

<ModeWatcher />
{#if accounts.list.length === 0}
  <LoginForm />
{:else}
  <AppShell />
{/if}
