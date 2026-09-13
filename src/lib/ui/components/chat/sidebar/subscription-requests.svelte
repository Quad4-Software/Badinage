<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts, type PendingSubscription } from '$lib/state/accounts.svelte'
  import { Button } from '$lib/ui/primitives/button'

  let { requests }: { requests: PendingSubscription[] } = $props()

  const account = $derived(accounts.active)
</script>

{#if requests.length > 0}
  <h2 class="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
    {$LL.subscriptionRequests()}
  </h2>
  {#each requests as request (request.from)}
    <div class="bg-muted/50 flex min-w-0 flex-col gap-2 rounded-md px-3 py-2">
      <p class="text-sm break-all">
        {$LL.wantsToSubscribe({ from: request.from })}
      </p>
      {#if request.status}
        <p class="text-muted-foreground text-xs break-words italic">{request.status}</p>
      {/if}
      <div class="flex gap-2">
        <Button size="sm" onclick={() => account?.acceptSubscription(request.from)}>
          {$LL.accept()}
        </Button>
        <Button size="sm" variant="ghost" onclick={() => account?.denySubscription(request.from)}>
          {$LL.deny()}
        </Button>
      </div>
    </div>
  {/each}
{/if}
