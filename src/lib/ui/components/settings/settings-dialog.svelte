<script lang="ts">
  import { Search } from '@lucide/svelte'

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
  import BlockedSection from './blocked-section.svelte'
  import DangerSection from './danger-section.svelte'
  import EncryptionSection from './encryption-section.svelte'
  import GeneralSection from './general-section.svelte'
  import KeybindingsSection from './keybindings-section.svelte'
  import PrivacySection from './privacy-section.svelte'

  let query = $state('')
  const q = $derived(query.trim().toLowerCase())

  let viewport = $state<HTMLDivElement | null>(null)

  const navItems = $derived([
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

  // reset the search when the dialog reopens
  $effect(() => {
    if (app.settingsOpen) query = ''
  })
</script>

<Dialog bind:open={app.settingsOpen}>
  <DialogContent class="flex h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
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
        <GeneralSection {q} />
        <PrivacySection {q} />
        <EncryptionSection {q} />
        <BlockedSection {q} />
        <AccountsSection {q} />
        <KeybindingsSection {q} />
        <DangerSection {q} />
      </ScrollArea>
    </div>
  </DialogContent>
</Dialog>
