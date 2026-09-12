<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Check, ChevronsUpDown, LogOut, Settings, UserPlus } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { cn } from '$lib/utils/cn'
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
  } from '$lib/ui/primitives/alert-dialog'
  import { Button, buttonVariants } from '$lib/ui/primitives/button'

  import PresenceDot from './presence-dot.svelte'

  const active = $derived(accounts.active)
  let confirmRemove = $state<string | null>(null)
  let ownPresence = $state('online')

  const presenceOptions = [
    { value: 'online', label: () => $LL.online() },
    { value: 'away', label: () => $LL.away() },
    { value: 'dnd', label: () => $LL.busy() }
  ]

  function setPresence(show: string) {
    ownPresence = show
    active?.connection.sendPresence(show === 'online' ? undefined : show)
  }
</script>

<div class="flex items-center gap-2">
  <DropdownMenu.Root>
    <DropdownMenu.Trigger class="min-w-0 flex-1">
      {#snippet child({ props })}
        <Button {...props} variant="outline" class="w-full justify-between">
          <span class="truncate">{active?.jid ?? ''}</span>
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
            <PresenceDot presence={account.status === 'connected' ? 'online' : 'offline'} />
            <span class="min-w-0 flex-1 truncate">{account.jid}</span>
            {#if account.jid === active?.jid}
              <Check class="size-4 shrink-0" />
            {/if}
          </DropdownMenu.Item>
        {/each}
        {#if active}
          <DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
          {#each presenceOptions as option (option.value)}
            <DropdownMenu.Item
              class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
              onSelect={() => setPresence(option.value)}
            >
              <PresenceDot presence={option.value} />
              {option.label()}
              {#if ownPresence === option.value}
                <Check class="ml-auto size-4 shrink-0" />
              {/if}
            </DropdownMenu.Item>
          {/each}
        {/if}
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

<AlertDialog open={confirmRemove !== null} onOpenChange={(o) => !o && (confirmRemove = null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{$LL.removeAccountTitle()}</AlertDialogTitle>
      <AlertDialogDescription>
        {$LL.removeAccountDescription({ jid: confirmRemove ?? '' })}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel class={cn(buttonVariants({ variant: 'outline' }))}>
        {$LL.cancel()}
      </AlertDialogCancel>
      <AlertDialogAction
        class={cn(buttonVariants({ variant: 'destructive' }))}
        onclick={() => {
          if (confirmRemove) accounts.remove(confirmRemove)
          confirmRemove = null
        }}
      >
        {$LL.confirm()}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
