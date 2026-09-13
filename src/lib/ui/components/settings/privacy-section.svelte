<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { SAMPLE_REPORT } from '$lib/ui/sample-report'
  import { Switch } from '$lib/ui/primitives/switch'

  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  type Flag =
    | 'sendChatStates'
    | 'sendReceipts'
    | 'sendReadMarkers'
    | 'sendRealTimeText'
    | 'allowAttention'
    | 'mapPreviews'
    | 'autoAway'

  const items = $derived(
    (
      [
        ['sendChatStates', $LL.sendTyping(), 'typing indicators'],
        ['sendReceipts', $LL.sendReceipts(), 'delivery receipts'],
        ['sendReadMarkers', $LL.sendReadMarkers(), 'read seen markers'],
        ['sendRealTimeText', $LL.realTimeText(), $LL.realTimeTextHint() + ' rtt live typing'],
        ['allowAttention', $LL.allowAttention(), $LL.allowAttentionHint() + ' buzz nudge'],
        ['mapPreviews', $LL.mapPreviews(), $LL.mapPreviewsHint() + ' tiles openstreetmap location'],
        ['autoAway', $LL.autoAway(), $LL.autoAwayHint() + ' idle presence']
      ] as [Flag, string, string][]
    ).filter(([, label, keywords]) => matchesQuery(q, label, keywords, $LL.privacy()))
  )

  const showCrashReporting = $derived(
    matchesQuery(
      q,
      $LL.crashReporting(),
      $LL.crashReportingHint(),
      'sentry error reports telemetry',
      $LL.privacy()
    )
  )
  const hits = $derived(items.length + (showCrashReporting ? 1 : 0))
  const visible = $derived(hits > 0)

  $effect(() => {
    settingsSearch.hits.privacy = hits
    return () => {
      delete settingsSearch.hits.privacy
    }
  })
</script>

<SettingSection id="privacy" title={$LL.privacy()} forceOpen={q !== ''} {visible}>
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
      <details class="text-xs">
        <summary
          class="text-primary cursor-pointer font-medium select-none [&::-webkit-details-marker]:hidden"
        >
          {$LL.crashPromptSample()}
        </summary>
        <pre
          class="bg-muted text-muted-foreground mt-2 max-h-48 overflow-auto rounded-md p-3 text-[11px] leading-snug break-all whitespace-pre-wrap">{SAMPLE_REPORT}</pre>
      </details>
    </div>
  {/if}
</SettingSection>
