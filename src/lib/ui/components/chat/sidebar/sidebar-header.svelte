<script lang="ts">
  import { PanelLeftClose, Search, Settings } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'

  import AccountSwitcher from '../../shell/account-switcher.svelte'
  import PresencePicker from '../../presence/presence-picker.svelte'
  import ThemeToggle from '../../shell/theme-toggle.svelte'

  let { query = $bindable('') }: { query?: string } = $props()
</script>

<div class="flex items-center justify-between gap-1 p-3">
  <h1 class="truncate text-lg font-semibold">{$LL.appName()}</h1>
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

<div class="px-3 pb-1">
  <AccountSwitcher />
</div>

<div class="px-3 pb-3">
  <PresencePicker />
</div>

<div class="px-3 pb-2">
  <div class="relative">
    <Search
      class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
    />
    <Input bind:value={query} placeholder={$LL.search()} aria-label={$LL.search()} class="pl-8" />
  </div>
</div>
