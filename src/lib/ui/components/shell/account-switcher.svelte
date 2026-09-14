<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Check, ChevronsUpDown, LogOut, Settings, UserPen, UserPlus } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { effectiveHue } from '$lib/utils/account'
  import { cn } from '$lib/utils/cn'
  import { bareJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'

  import { presenceLabel, presenceRingClass } from '$lib/ui/presence'

  import PeerAvatar from '../chat/peer-avatar.svelte'
  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import PresenceMenu from '../presence/presence-menu.svelte'

  const active = $derived(accounts.active)
  let menuOpen = $state(false)
  let confirmRemove = $state<string | null>(null)
</script>

<div class="flex items-center gap-2">
  <DropdownMenu.Root bind:open={menuOpen}>
    <DropdownMenu.Trigger class="min-w-0 flex-1">
      {#snippet child({ props })}
        <Button {...props} variant="outline" class="w-full justify-between">
          <span class="flex min-w-0 items-center gap-2">
            {#if active}
              {@const shown =
                active.invisible || active.status !== 'connected' ? 'offline' : active.presence}
              <PeerAvatar
                jid={bareJid(active.jid)}
                fallback={active.jid.slice(0, 2)}
                account={active}
                force
                class={cn(
                  'ring-offset-background size-5 shrink-0 ring-2 ring-offset-1',
                  presenceRingClass(shown)
                )}
              />
              <span class="sr-only">{presenceLabel(shown)}</span>
            {/if}
            <span class="truncate">{active?.jid ?? ''}</span>
            {#if active?.options.protocol === 'irc'}
              <span
                class="bg-muted text-muted-foreground shrink-0 rounded px-1 py-px text-[0.6rem] font-medium uppercase"
              >
                {$LL.protocolIrc()}
              </span>
            {/if}
          </span>
          <ChevronsUpDown class="me-1 size-4 shrink-0 opacity-50" />
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
            <span class="relative shrink-0">
              <PeerAvatar
                jid={bareJid(account.jid)}
                fallback={account.jid.slice(0, 2)}
                {account}
                force
                class="size-5"
              />
              <span
                class="border-background absolute -right-0.5 -bottom-0.5 size-2 rounded-full border"
                style={`background: oklch(0.65 0.17 ${effectiveHue(settings.metaFor(account.jid), account.jid)})`}
                aria-hidden="true"
              ></span>
            </span>
            <span class="min-w-0 flex-1 truncate">{account.jid}</span>
            {#if account.options.protocol === 'irc'}
              <span
                class="bg-muted text-muted-foreground shrink-0 rounded px-1 py-px text-[0.6rem] font-medium uppercase"
              >
                {$LL.protocolIrc()}
              </span>
            {/if}
            {#if account.latency !== null}
              <span class="text-muted-foreground shrink-0 text-xs">
                {$LL.latencyMs({ ms: account.latency })}
              </span>
            {/if}
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
          {#if active.caps.profile}
            <DropdownMenu.Item
              class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
              onSelect={() => (app.profileOpen = true)}
            >
              <UserPen class="size-4" />
              {$LL.editProfile()}
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Item
            class="text-destructive data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
            onSelect={() => (confirmRemove = active.jid)}
          >
            <LogOut class="size-4" />
            {$LL.removeAccount()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
          <PresenceMenu account={active} close={() => (menuOpen = false)} />
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
