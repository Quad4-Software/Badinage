<script lang="ts">
  import { CloudOff, Wrench } from '@lucide/svelte'

  import LL, { locale } from '$lib/i18n/i18n-svelte'
  import type { DeploymentStatus } from '$lib/core/status'
  import { Button } from '$lib/ui/primitives/button'
  import { formatTime } from '$lib/utils/time'

  // takeover page for declared 'full' maintenance and 'outage' modes.
  // Rendered instead of the whole shell so nothing underneath stays
  // interactive
  let { status }: { status: DeploymentStatus } = $props()

  const outage = $derived(status.mode === 'outage')
  const until = $derived(status.until !== undefined && Date.parse(status.until) > Date.now())
</script>

<main class="flex h-full items-center justify-center p-6">
  <div class="flex w-full max-w-md flex-col items-center gap-4 text-center">
    {#if outage}
      <CloudOff class="text-muted-foreground size-10" aria-hidden="true" />
    {:else}
      <Wrench class="text-muted-foreground size-10" aria-hidden="true" />
    {/if}
    <h1 class="text-lg font-semibold">
      {outage ? $LL.statusOutageTitle() : $LL.statusMaintenanceTitle()}
    </h1>
    <p class="text-muted-foreground text-sm">
      {status.message ?? (outage ? $LL.statusOutageDefault() : $LL.statusMaintenanceDefault())}
    </p>
    {#if until && status.until}
      <p class="text-muted-foreground text-xs">
        {$LL.statusExpectedBack({ time: formatTime(Date.parse(status.until), $locale) })}
      </p>
    {/if}
    <Button variant="outline" onclick={() => location.reload()}>{$LL.statusRetry()}</Button>
  </div>
</main>
