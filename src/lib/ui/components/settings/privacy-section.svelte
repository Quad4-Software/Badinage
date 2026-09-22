<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { CRASH_REPORTING_PROMPT } from '$lib/state/app/prompts.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import SampleReport from '$lib/ui/components/prompts/sample-report.svelte'
  import { Switch } from '$lib/ui/primitives/switch'

  import LockControls from './lock/lock-controls.svelte'
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
  const showLock = $derived(
    matchesQuery(
      q,
      $LL.appLock(),
      $LL.appLockHint(),
      'lock passphrase security vault seal auto-lock',
      $LL.privacy()
    )
  )
  const hits = $derived(items.length + (showCrashReporting ? 1 : 0) + (showLock ? 1 : 0))
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
  {#if showLock}
    <LockControls />
  {/if}
  {#if showCrashReporting}
    <div class="flex flex-col gap-1">
      <label class="flex items-center justify-between gap-4 text-sm">
        {$LL.crashReporting()}
        <Switch
          checked={settings.current.crashReporting}
          onCheckedChange={(v) => {
            settings.set('crashReporting', v)
            // an explicit toggle counts as answering the opt-in prompt:
            // without the marker the next launch folds the value to off
            settings.markPromptSeen(CRASH_REPORTING_PROMPT.id, CRASH_REPORTING_PROMPT.version)
          }}
        />
      </label>
      <p class="text-muted-foreground text-xs">{$LL.crashReportingHint()}</p>
      <SampleReport />
    </div>
  {/if}
</SettingSection>
