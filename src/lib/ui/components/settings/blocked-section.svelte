<script lang="ts">
  import { Ban, Plus, X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { bareJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'

  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  const account = $derived(accounts.active)
  let newJid = $state('')

  const list = $derived(
    account ? [...account.blocked].filter((jid) => matchesQuery(q, jid)).sort() : []
  )

  // the section doubles as the place to add new blocks, so it stays
  // visible while searching only when it has matching rows or the add
  // form itself matches
  const showForm = $derived(
    matchesQuery(
      q,
      $LL.blockedContacts(),
      $LL.blockUser(),
      $LL.unblockUser(),
      $LL.block(),
      'blocklist blacklist ignore'
    )
  )
  const hits = $derived(list.length + (showForm ? 1 : 0))
  const visible = $derived(hits > 0)

  $effect(() => {
    settingsSearch.hits.blocked = hits
    return () => {
      delete settingsSearch.hits.blocked
    }
  })

  function add() {
    const jid = bareJid(newJid.trim())
    if (!jid) return
    account?.block(jid)
    newJid = ''
  }
</script>

<SettingSection id="blocked" title={$LL.blockedContacts()} forceOpen={q !== ''} {visible}>
  {#if showForm}
    <form
      class="flex items-center gap-2"
      onsubmit={(event) => {
        event.preventDefault()
        add()
      }}
    >
      <Input
        bind:value={newJid}
        placeholder={$LL.blockJidPlaceholder()}
        aria-label={$LL.blockJidPlaceholder()}
        class="h-8 min-w-0 flex-1 text-sm"
      />
      <Button type="submit" variant="outline" size="sm" disabled={!newJid.trim()}>
        <Plus class="size-3.5" />
        {$LL.block()}
      </Button>
    </form>
  {/if}

  {#if list.length > 0}
    <ul class="flex flex-col">
      {#each list as jid (jid)}
        <li class="flex items-center gap-2 py-1">
          <Ban class="text-muted-foreground size-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-sm">{jid}</span>
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0"
            onclick={() => account?.unblock(jid)}
            aria-label={$LL.unblockJid({ jid })}
          >
            <X class="size-3.5" />
            {$LL.unblock()}
          </Button>
        </li>
      {/each}
    </ul>
    {#if list.length > 1}
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs underline underline-offset-2"
        onclick={() => account?.unblockAll()}
      >
        {$LL.unblockAll()}
      </button>
    {/if}
  {:else}
    <p class="text-muted-foreground text-xs">
      {q ? $LL.noBlockedMatch() : $LL.blockedEmpty()}
    </p>
  {/if}
</SettingSection>
