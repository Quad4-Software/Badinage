<script lang="ts">
  import { WifiOff, Wrench, X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { deployment } from '$lib/state/status/status.svelte'

  // slim strip above the shell for 'soft' maintenance and browser
  // offline. Soft banners are dismissible per message so a changed
  // announcement re-raises. The offline banner stays until the network
  // returns. Hidden while a blocking status page is up
  let dismissed = $state('')

  const status = $derived(deployment.status)
  const soft = $derived(status.mode === 'soft' && dismissed !== (status.message ?? ''))
  const visible = $derived(!deployment.blocking && (deployment.offline || soft))
</script>

{#if visible}
  <div
    role="status"
    class="bg-secondary text-secondary-foreground flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs"
  >
    {#if deployment.offline}
      <WifiOff class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{$LL.statusOffline()}</span>
    {:else}
      <Wrench class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{status.message ?? $LL.statusMaintenanceDefault()}</span
      >
      <button
        type="button"
        class="hover:bg-accent flex size-5 shrink-0 items-center justify-center rounded"
        aria-label={$LL.close()}
        onclick={() => (dismissed = status.message ?? '')}
      >
        <X class="size-3.5" />
      </button>
    {/if}
  </div>
{/if}
