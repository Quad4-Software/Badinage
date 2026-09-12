<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Check, ChevronsUpDown, LogOut } from 'lucide-svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { cn } from '$lib/utils/cn'
  import { Button } from '$lib/ui/primitives/button'
  import PresenceDot from './presence-dot.svelte'

  const active = $derived(accounts.active)
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="w-full">
    {#snippet child({ props })}
      <Button {...props} variant="outline" class="w-full justify-between">
        <span class="truncate">{active?.jid ?? ''}</span>
        <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="bg-popover text-popover-foreground z-50 min-w-56 rounded-md border p-1 shadow-md"
      sideOffset={4}
      align="start"
    >
      {#each accounts.list as account (account.jid)}
        <DropdownMenu.Item
          class={cn(
            'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
            'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground'
          )}
          onSelect={() => (accounts.activeJid = account.jid)}
        >
          <PresenceDot presence={account.status === 'connected' ? 'online' : 'offline'} />
          <span class="flex-1 truncate">{account.jid}</span>
          {#if account.jid === active?.jid}
            <Check class="size-4" />
          {/if}
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
      {#if active}
        <DropdownMenu.Item
          class="text-destructive data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
          onSelect={() => accounts.remove(active.jid)}
        >
          <LogOut class="size-4" />
          {$LL.removeAccount()}
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
