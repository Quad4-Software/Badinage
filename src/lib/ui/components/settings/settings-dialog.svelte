<script lang="ts">
  import { Search } from '@lucide/svelte'
  import { tick } from 'svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Input } from '$lib/ui/primitives/input'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'

  import AccountsSection from './accounts-section.svelte'
  import AppearanceSection from './appearance-section.svelte'
  import BlockedSection from './blocked-section.svelte'
  import DangerSection from './danger-section.svelte'
  import EncryptionSection from './encryption-section.svelte'
  import GeneralSection from './general-section.svelte'
  import KeybindingsSection from './keybindings-section.svelte'
  import PrivacySection from './privacy-section.svelte'
  import { settingsSearch } from './search-state.svelte'

  let query = $state('')
  const q = $derived(query.trim().toLowerCase())

  // every section reports its visible row count into settingsSearch.hits
  const totalHits = $derived(Object.values(settingsSearch.hits).reduce((sum, n) => sum + n, 0))

  let viewport = $state<HTMLDivElement | null>(null)

  const navItems = $derived([
    { id: 'appearance', label: $LL.appearance() },
    { id: 'general', label: $LL.general() },
    { id: 'privacy', label: $LL.privacy() },
    { id: 'encryption', label: $LL.encryption() },
    { id: 'blocked', label: $LL.blockedContacts() },
    { id: 'accounts', label: $LL.accounts() },
    { id: 'keyboard', label: $LL.keyboard() },
    { id: 'danger', label: $LL.dangerZone() }
  ])

  function jump(id: string) {
    viewport
      ?.querySelector(`[data-section="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // reset the search when the dialog reopens, and honor a deep link from
  // the command palette by scrolling to the requested section
  $effect(() => {
    if (!app.settingsOpen) return
    query = ''
    const pending = app.pendingSettingsSection
    if (!pending) return
    app.pendingSettingsSection = null
    void tick().then(() => requestAnimationFrame(() => jump(pending)))
  })
</script>

<Dialog bind:open={app.settingsOpen}>
  <DialogContent
    class="flex h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[85vh] sm:max-w-3xl sm:rounded-lg lg:max-w-4xl xl:max-w-5xl"
  >
    <div class="border-b px-5 pt-5 pr-12 pb-4">
      <DialogHeader>
        <DialogTitle>{$LL.settings()}</DialogTitle>
        <DialogDescription>{$LL.settingsHint()}</DialogDescription>
      </DialogHeader>
      <div class="relative mt-3">
        <Search
          class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        />
        <Input
          bind:value={query}
          placeholder={$LL.searchSettings()}
          aria-label={$LL.searchSettings()}
          class="pl-8"
        />
      </div>
    </div>

    <nav
      class="flex gap-1.5 overflow-x-auto border-b px-3 py-2 md:hidden"
      aria-label={$LL.settings()}
    >
      {#each navItems as item (item.id)}
        <button
          type="button"
          class="hover:bg-accent shrink-0 cursor-pointer rounded-full border px-3 py-1 text-xs whitespace-nowrap"
          onclick={() => jump(item.id)}
        >
          {item.label}
        </button>
      {/each}
    </nav>

    <div class="flex min-h-0 flex-1">
      <nav
        class="hidden w-44 shrink-0 flex-col gap-0.5 border-r p-3 md:flex"
        aria-label={$LL.settings()}
      >
        {#each navItems as item (item.id)}
          <button
            type="button"
            class="hover:bg-accent cursor-pointer rounded-md px-2 py-1.5 text-left text-sm"
            onclick={() => jump(item.id)}
          >
            {item.label}
          </button>
        {/each}
      </nav>

      <ScrollArea class="min-w-0 flex-1" bind:viewportRef={viewport}>
        <AppearanceSection {q} />
        <GeneralSection {q} />
        <PrivacySection {q} />
        <EncryptionSection {q} />
        <BlockedSection {q} />
        <AccountsSection {q} />
        <KeybindingsSection {q} />
        <DangerSection {q} />
        {#if q && totalHits === 0}
          <p class="text-muted-foreground px-5 py-8 text-center text-sm">
            {$LL.noSettingsResults()}
          </p>
        {/if}
      </ScrollArea>
    </div>
  </DialogContent>
</Dialog>
