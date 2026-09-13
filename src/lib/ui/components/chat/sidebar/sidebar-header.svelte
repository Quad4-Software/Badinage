<script lang="ts">
  import { PanelLeftClose, Search, Settings } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import { Button } from '$lib/ui/primitives/button'

  import AccountSwitcher from '../../shell/account-switcher.svelte'
  import ThemeToggle from '../../shell/theme-toggle.svelte'

  // bindable for chat-sidebar compat; the command palette replaced the
  // in-sidebar filter input so nothing reads this anymore
  // eslint-disable-next-line no-useless-assignment
  let { query: _query = $bindable('') }: { query?: string } = $props()
</script>

<div class="flex items-center justify-between gap-1 p-3">
  <h1 class="font-pixel truncate text-lg">{$LL.appName()}</h1>
  <div class="flex items-center gap-0.5">
    <Button
      variant="ghost"
      size="icon"
      class="hidden md:inline-flex"
      onclick={() => app.dispatch('nav.toggleSidebar')}
      aria-label={$LL.collapseSidebar()}
    >
      <PanelLeftClose class="size-4" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      onclick={() => (app.settingsOpen = true)}
      aria-label={$LL.openSettings()}
    >
      <Settings class="size-4" />
    </Button>
    <ThemeToggle />
  </div>
</div>

<div class="px-3 pb-3">
  <AccountSwitcher />
</div>

<div class="px-3 pb-2">
  <div class="relative">
    <Search
      class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
    />
    <button
      type="button"
      class="border-input text-muted-foreground flex h-9 w-full min-w-0 items-center rounded-md border bg-transparent pr-3 pl-8 text-base shadow-xs md:text-sm"
      onclick={() => (app.paletteOpen = true)}
      aria-label={$LL.search()}
    >
      <span class="truncate">{$LL.palettePlaceholder()}</span>
    </button>
  </div>
</div>
