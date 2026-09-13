<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { Switch } from '$lib/ui/primitives/switch'

  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  type Flag = 'sendWithEnter' | 'notifications' | 'sounds'

  const items = $derived(
    (
      [
        ['sendWithEnter', $LL.sendWithEnter(), 'return key newline'],
        ['notifications', $LL.notifications(), 'alerts desktop notify'],
        ['sounds', $LL.sounds(), 'audio mute beep']
      ] as [Flag, string, string][]
    ).filter(([, label, keywords]) => matchesQuery(q, label, keywords, $LL.general()))
  )

  $effect(() => {
    settingsSearch.hits.general = items.length
    return () => {
      delete settingsSearch.hits.general
    }
  })
</script>

<SettingSection id="general" title={$LL.general()} visible={items.length > 0}>
  {#each items as [key, label] (key)}
    <label class="flex items-center justify-between gap-4 text-sm">
      {label}
      <Switch checked={settings.current[key]} onCheckedChange={(v) => settings.set(key, v)} />
    </label>
  {/each}
</SettingSection>
