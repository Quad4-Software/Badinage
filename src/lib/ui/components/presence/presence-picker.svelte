<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Check, ChevronDown, EyeOff } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { Input } from '$lib/ui/primitives/input'
  import { PRESENCE_VALUES, presenceLabel } from '$lib/ui/presence'

  import PresenceDot from './presence-dot.svelte'

  const account = $derived(accounts.active)
  const presence = $derived(account?.presence ?? 'online')
  const presenceStatus = $derived(account?.presenceStatus ?? '')
  const invisible = $derived(account?.invisible ?? false)

  let statusDraft = $state('')
  let menuOpen = $state(false)

  // preload the draft with the current status each time the menu opens
  $effect(() => {
    if (menuOpen) statusDraft = presenceStatus
  })

  function applyStatus() {
    account?.setPresence(presence, statusDraft.trim())
    menuOpen = false
  }
</script>

<DropdownMenu.Root bind:open={menuOpen}>
  <DropdownMenu.Trigger class="min-w-0 flex-1">
    {#snippet child({ props })}
      <button
        {...props}
        class="hover:bg-accent flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none"
        aria-label={$LL.presencePickerLabel()}
      >
        <PresenceDot presence={account?.status === 'connected' ? presence : 'offline'} />
        <span class="min-w-0 flex-1 truncate text-left">
          {invisible
            ? $LL.invisible()
            : presenceLabel(account?.status === 'connected' ? presence : 'offline')}
        </span>
        {#if presenceStatus}
          <span class="text-muted-foreground min-w-0 truncate text-xs">{presenceStatus}</span>
        {/if}
        <ChevronDown class="text-muted-foreground size-3.5 shrink-0" />
      </button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="bg-popover text-popover-foreground z-50 w-(--bits-dropdown-menu-anchor-width) min-w-48 rounded-md border p-1 shadow-md"
      sideOffset={4}
      align="start"
    >
      {#each PRESENCE_VALUES as value (value)}
        <DropdownMenu.Item
          class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
          onSelect={() => account?.setPresence(value)}
        >
          <PresenceDot presence={value} />
          <span class="flex-1">{presenceLabel(value)}</span>
          {#if presence === value}
            <Check class="size-4 shrink-0" />
          {/if}
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
      <!-- XEP-0186: not a presence show value; a privacy list that
           denies outbound presence. Kept visually distinct so it does
           not look like a fifth show state -->
      <DropdownMenu.Item
        class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
        onSelect={() => account?.setInvisible(!invisible)}
        title={$LL.invisibleHint()}
      >
        <EyeOff class="text-muted-foreground size-4" />
        <span class="flex-1">{$LL.invisible()}</span>
        {#if invisible}
          <Check class="size-4 shrink-0" />
        {/if}
      </DropdownMenu.Item>
      <DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
      <div class="px-1 py-1">
        <Input
          bind:value={statusDraft}
          placeholder={$LL.statusPlaceholder()}
          aria-label={$LL.statusMessage()}
          class="h-8 text-sm"
          onkeydown={(event) => {
            // menu typeahead would steal letters; keep typing local
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              applyStatus()
            }
          }}
        />
        <p class="text-muted-foreground px-1 pt-1 text-xs">{$LL.statusMessageHint()}</p>
      </div>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
