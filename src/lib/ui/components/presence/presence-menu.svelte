<script lang="ts">
  import { untrack } from 'svelte'
  import { DropdownMenu } from 'bits-ui'
  import { Check, EyeOff, Plug, Unplug } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Account } from '$lib/state/accounts.svelte'
  import { Input } from '$lib/ui/primitives/input'
  import { cn } from '$lib/utils/cn'
  import { PRESENCE_VALUES, presenceClass, presenceLabel } from '$lib/ui/presence'

  // items only: the account switcher owns the DropdownMenu.Root and the
  // content these render into, so they must stay inside its Content
  let { account, close }: { account: Account; close: () => void } = $props()

  const connected = $derived(account.status === 'connected')
  const invisible = $derived(account.invisible)

  // mounts fresh on every dropdown open, so the draft snapshots the
  // published status rather than a stale edit
  let statusDraft = $state(untrack(() => account.presenceStatus))

  const itemClass =
    'data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'

  function applyStatus() {
    account.setPresence(account.presence, statusDraft.trim())
    close()
  }
</script>

{#each PRESENCE_VALUES as value (value)}
  <DropdownMenu.Item class={itemClass} onSelect={() => account.setPresence(value)}>
    <span class={cn('flex-1', presenceClass(value))}>{presenceLabel(value)}</span>
    {#if connected && !invisible && account.presence === value}
      <Check class="size-4 shrink-0" />
    {/if}
  </DropdownMenu.Item>
{/each}
<DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
<!-- XEP-0186: not a presence show value. A privacy list that denies
     outbound presence. Kept visually distinct from the show states -->
<DropdownMenu.Item
  class={itemClass}
  onSelect={() => account.setInvisible(!invisible)}
  title={$LL.invisibleHint()}
>
  <EyeOff class="text-muted-foreground size-4" />
  <span class="flex-1">{$LL.invisible()}</span>
  {#if invisible}
    <Check class="size-4 shrink-0" />
  {/if}
</DropdownMenu.Item>
<div class="px-1 py-1">
  <Input
    bind:value={statusDraft}
    placeholder={$LL.statusPlaceholder()}
    aria-label={$LL.statusMessage()}
    class="h-8 text-sm"
    onkeydown={(event) => {
      // menu typeahead would steal letters. Keep typing local
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        applyStatus()
      }
    }}
  />
  <p class="text-muted-foreground px-1 pt-1 text-xs">{$LL.statusMessageHint()}</p>
</div>
<DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
<DropdownMenu.Item
  class={itemClass}
  onSelect={() => {
    if (connected) account.disconnect()
    else void account.connect()
  }}
>
  {#if connected}
    <Unplug class="text-muted-foreground size-4" />
    <span class="flex-1">{$LL.disconnect()}</span>
  {:else}
    <Plug class="text-muted-foreground size-4" />
    <span class="flex-1">{$LL.reconnect()}</span>
  {/if}
</DropdownMenu.Item>
