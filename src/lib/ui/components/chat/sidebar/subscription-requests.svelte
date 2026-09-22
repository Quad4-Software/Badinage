<script lang="ts">
  import { UserRoundPlus } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts, type PendingSubscription } from '$lib/state/accounts.svelte'
  import { Button } from '$lib/ui/primitives/button'

  import PeerAvatar from '../peer-avatar.svelte'

  let { requests }: { requests: PendingSubscription[] } = $props()

  const account = $derived(accounts.active)
</script>

{#if requests.length > 0}
  <h2 class="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
    {$LL.subscriptionRequests()}
  </h2>
  {#each requests as request (request.from)}
    <div class="bg-card mb-2 flex min-w-0 flex-col gap-2 rounded-lg border p-3 shadow-xs">
      <div class="flex items-center gap-2.5">
        <PeerAvatar
          jid={request.from}
          fallback={request.from.slice(0, 2)}
          class="size-9 shrink-0"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{request.from}</p>
          <p class="text-muted-foreground truncate text-xs">{$LL.presenceAsk()}</p>
        </div>
        <UserRoundPlus class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </div>
      {#if request.status}
        <p class="text-muted-foreground border-border border-l-2 pl-2 text-xs break-words italic">
          {request.status}
        </p>
      {/if}
      <div class="flex gap-2">
        <Button size="sm" class="flex-1" onclick={() => account?.acceptSubscription(request.from)}>
          {$LL.accept()}
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="flex-1"
          onclick={() => account?.denySubscription(request.from)}
        >
          {$LL.deny()}
        </Button>
      </div>
    </div>
  {/each}
{/if}
