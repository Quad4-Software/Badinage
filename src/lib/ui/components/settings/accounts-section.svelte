<script lang="ts">
  import { LogOut, UserPlus } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { Button } from '$lib/ui/primitives/button'

  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import PresenceDot from '../presence/presence-dot.svelte'
  import { matchesQuery } from './match'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  const list = $derived(accounts.list.filter((a) => matchesQuery(q, a.jid)))
  let confirmRemove = $state<string | null>(null)

  const statusLabel = (status: string) =>
    status === 'connected'
      ? $LL.online()
      : status === 'connecting'
        ? $LL.connecting()
        : $LL.offline()
</script>

<SettingSection
  id="accounts"
  title={$LL.accounts()}
  visible={list.length > 0 || matchesQuery(q, $LL.accounts())}
>
  <ul class="flex flex-col">
    {#each list as account (account.jid)}
      <li class="flex items-center gap-2.5 py-1.5">
        <PresenceDot presence={account.status === 'connected' ? 'online' : 'offline'} />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm">{account.jid}</span>
          <span class="text-muted-foreground block text-xs">{statusLabel(account.status)}</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          class="shrink-0"
          onclick={() => (confirmRemove = account.jid)}
          aria-label={$LL.removeAccount()}
        >
          <LogOut class="size-3.5" />
          {$LL.removeAccount()}
        </Button>
      </li>
    {/each}
  </ul>
  <Button variant="outline" size="sm" class="w-fit" onclick={() => (app.loginOpen = true)}>
    <UserPlus class="size-3.5" />
    {$LL.addAccount()}
  </Button>
</SettingSection>

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
