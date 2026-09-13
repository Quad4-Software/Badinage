<script lang="ts">
  import { ArrowDown, ArrowUp, Bell, LogOut, UserPlus } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { effectiveHue, nextAccountHue } from '$lib/utils/account'
  import { Button } from '$lib/ui/primitives/button'
  import { Switch } from '$lib/ui/primitives/switch'

  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import PeerAvatar from '../chat/peer-avatar.svelte'
  import PresenceDot from '../presence/presence-dot.svelte'
  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  const statusLabel = (status: string) =>
    status === 'connected'
      ? $LL.online()
      : status === 'connecting'
        ? $LL.connecting()
        : $LL.offline()

  const list = $derived(
    accounts.list.filter((a) => matchesQuery(q, a.jid, statusLabel(a.status), $LL.accounts()))
  )
  let confirmRemove = $state<string | null>(null)

  // ordering acts on the full list so the controls stay correct while a
  // settings search filters the visible rows
  const orderIndex = (jid: string) => accounts.list.findIndex((a) => a.jid === jid)

  const showAdd = $derived(
    matchesQuery(q, $LL.accounts(), $LL.addAccount(), $LL.removeAccount(), 'sign in login logout')
  )
  const hits = $derived(list.length + (showAdd ? 1 : 0))

  $effect(() => {
    settingsSearch.hits.accounts = hits
    return () => {
      delete settingsSearch.hits.accounts
    }
  })
</script>

<SettingSection id="accounts" title={$LL.accounts()} forceOpen={q !== ''} visible={hits > 0}>
  <ul class="flex flex-col">
    {#each list as account (account.jid)}
      {@const meta = settings.metaFor(account.jid)}
      <li class="flex items-center gap-2.5 py-1.5">
        <button
          type="button"
          class="ring-offset-background shrink-0 cursor-pointer rounded-full ring-2 ring-offset-1"
          style={`--tw-ring-color: oklch(0.65 0.17 ${effectiveHue(meta, account.jid)})`}
          aria-label={$LL.accountColor({ jid: account.jid })}
          title={$LL.accountColor({ jid: account.jid })}
          onclick={() => settings.setAccountMeta(account.jid, { hue: nextAccountHue(meta.hue) })}
        >
          <PeerAvatar
            {account}
            jid={account.jid}
            fallback={account.jid.slice(0, 2)}
            force
            class="size-6"
          />
        </button>
        <PresenceDot presence={account.status === 'connected' ? 'online' : 'offline'} />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm">{account.jid}</span>
          <span class="text-muted-foreground block text-xs">{statusLabel(account.status)}</span>
        </span>
        <span class="flex shrink-0 items-center" role="group" aria-label={account.jid}>
          <Button
            variant="ghost"
            size="icon"
            class="size-6"
            disabled={orderIndex(account.jid) <= 0}
            onclick={() => accounts.move(account.jid, -1)}
            aria-label={$LL.moveAccountUp({ jid: account.jid })}
          >
            <ArrowUp class="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="size-6"
            disabled={orderIndex(account.jid) === accounts.list.length - 1}
            onclick={() => accounts.move(account.jid, 1)}
            aria-label={$LL.moveAccountDown({ jid: account.jid })}
          >
            <ArrowDown class="size-3.5" />
          </Button>
        </span>
        <Bell class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        <Switch
          checked={meta.notify !== false}
          onCheckedChange={(v) => settings.setAccountMeta(account.jid, { notify: v })}
          aria-label={$LL.accountNotifications({ jid: account.jid })}
        />
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
  {#if showAdd}
    <Button variant="outline" size="sm" class="w-fit" onclick={() => (app.loginOpen = true)}>
      <UserPlus class="size-3.5" />
      {$LL.addAccount()}
    </Button>
  {/if}
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
