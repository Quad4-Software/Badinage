<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Check, ChevronsUpDown, LogOut, Settings, UserPlus } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { cn } from '$lib/utils/cn'
  import { bareJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'

  import PeerAvatar from '../chat/peer-avatar.svelte'
  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import PresenceDot from '../presence/presence-dot.svelte'

  const active = $derived(accounts.active)
  let confirmRemove = $state<string | null>(null)
</script>

<div class="flex items-center gap-2">
  <DropdownMenu.Root>
    <DropdownMenu.Trigger class="min-w-0 flex-1">
      {#snippet child({ props })}
        <Button {...props} variant="outline" class="w-full justify-between">
          <span class="flex min-w-0 items-center gap-2">
            {#if active}
              <PeerAvatar
                jid={bareJid(active.jid)}
                fallback={active.jid.slice(0, 2)}
                account={active}
                force
                class="size-5"
              />
            {/if}
            <span class="truncate">{active?.jid ?? ''}</span>
          </span>
          <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        class="bg-popover text-popover-foreground z-50 w-(--bits-dropdown-menu-anchor-width) min-w-0 rounded-md border p-1 shadow-md"
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
            <PeerAvatar
              jid={bareJid(account.jid)}
              fallback={account.jid.slice(0, 2)}
              account={account}
              force
              class="size-5"
            />
            <PresenceDot presence={account.status === 'connected' ? 'online' : 'offline'} />
            <span class="min-w-0 flex-1 truncate">{account.jid}</span>
            {#if account.jid === active?.jid}
              <Check class="size-4 shrink-0" />
            {/if}
          </DropdownMenu.Item>
        {/each}
        <DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
        <DropdownMenu.Item
          class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
          onSelect={() => (app.loginOpen = true)}
        >
          <UserPlus class="size-4" />
          {$LL.addAccount()}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
          onSelect={() => (app.settingsOpen = true)}
        >
          <Settings class="size-4" />
          {$LL.openSettings()}
        </DropdownMenu.Item>
        {#if active}
          <DropdownMenu.Item
            class="text-destructive data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
            onSelect={() => (confirmRemove = active.jid)}
          >
            <LogOut class="size-4" />
            {$LL.removeAccount()}
          </DropdownMenu.Item>
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
</div>

<ConfirmDialog
  open={confirmRemove !== null}
  onOpenChange={(o) => !o && (confirmRemove = null)}
  title={$LL.removeAccountTitle()}
  description={$LL.removeAccountDescription({ jid: confirmRemove ?? '' })}
  confirmLabel={$LL.confirm()}
  destructive
  onConfirm={() => {
    if (confirmRemove) accounts.remove(confirmRemove)
    confirmRemove = null
  }}
/>
