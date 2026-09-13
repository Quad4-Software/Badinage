<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { Switch } from '$lib/ui/primitives/switch'

  import { matchesQuery } from './match'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  type Flag = 'sendChatStates' | 'sendReceipts' | 'sendReadMarkers'

  const items = $derived(
    (
      [
        ['sendChatStates', $LL.sendTyping()],
        ['sendReceipts', $LL.sendReceipts()],
        ['sendReadMarkers', $LL.sendReadMarkers()]
      ] as [Flag, string][]
    ).filter(([, label]) => matchesQuery(q, label, $LL.privacy()))
  )

  const showCrashReporting = $derived(matchesQuery(q, $LL.crashReporting(), $LL.privacy()))
  const visible = $derived(items.length > 0 || showCrashReporting)
</script>

<SettingSection id="privacy" title={$LL.privacy()} {visible}>
  {#each items as [key, label] (key)}
    <label class="flex items-center justify-between gap-4 text-sm">
      {label}
      <Switch checked={settings.current[key]} onCheckedChange={(v) => settings.set(key, v)} />
    </label>
  {/each}
  {#if showCrashReporting}
    <div class="flex flex-col gap-1">
      <label class="flex items-center justify-between gap-4 text-sm">
        {$LL.crashReporting()}
        <Switch
          checked={settings.current.crashReporting}
          onCheckedChange={(v) => settings.set('crashReporting', v)}
        />
      </label>
      <p class="text-muted-foreground text-xs">{$LL.crashReportingHint()}</p>
    </div>
  {/if}
</SettingSection>
