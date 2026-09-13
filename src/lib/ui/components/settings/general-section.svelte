<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { Switch } from '$lib/ui/primitives/switch'

  import { matchesQuery } from './match'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  type Flag = 'sendWithEnter' | 'notifications' | 'sounds'

  const items = $derived(
    (
      [
        ['sendWithEnter', $LL.sendWithEnter()],
        ['notifications', $LL.notifications()],
        ['sounds', $LL.sounds()]
      ] as [Flag, string][]
    ).filter(([, label]) => matchesQuery(q, label, $LL.general()))
  )
</script>

<SettingSection id="general" title={$LL.general()} visible={items.length > 0}>
  {#each items as [key, label] (key)}
    <label class="flex items-center justify-between gap-4 text-sm">
      {label}
      <Switch checked={settings.current[key]} onCheckedChange={(v) => settings.set(key, v)} />
    </label>
  {/each}
</SettingSection>
