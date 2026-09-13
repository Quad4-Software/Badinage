<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { wipeAllData } from '$lib/state/storage'
  import { Button } from '$lib/ui/primitives/button'

  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  let confirmWipe = $state(false)
  let confirmReset = $state(false)

  const show = $derived(
    matchesQuery(
      q,
      $LL.dangerZone(),
      $LL.wipeData(),
      $LL.wipeDataHint(),
      $LL.resetSettings(),
      'delete reset clear defaults restore'
    )
  )

  $effect(() => {
    settingsSearch.hits.danger = show ? 1 : 0
    return () => {
      delete settingsSearch.hits.danger
    }
  })

  async function wipeData() {
    // every badinage-namespaced key plus all IndexedDB stores; ui/ must
    // not touch storage globals directly
    await wipeAllData()
    location.reload()
  }
</script>

<SettingSection
  id="danger"
  title={$LL.dangerZone()}
  titleClass="text-destructive text-sm font-medium"
  forceOpen={q !== ''}
  visible={show}
>
  <div class="flex items-center justify-between gap-4">
    <p class="text-muted-foreground text-xs">{$LL.resetSettingsHint()}</p>
    <Button variant="outline" size="sm" onclick={() => (confirmReset = true)}>
      {$LL.resetSettings()}
    </Button>
  </div>
  <div class="flex items-center justify-between gap-4">
    <p class="text-muted-foreground text-xs">{$LL.wipeDataHint()}</p>
    <Button variant="destructive" size="sm" onclick={() => (confirmWipe = true)}>
      {$LL.wipeData()}
    </Button>
  </div>
</SettingSection>

<ConfirmDialog
  bind:open={confirmReset}
  title={$LL.resetSettingsTitle()}
  description={$LL.resetSettingsDescription()}
  confirmLabel={$LL.resetSettings()}
  destructive
  onConfirm={() => settings.resetToDefaults()}
/>

<ConfirmDialog
  bind:open={confirmWipe}
  title={$LL.wipeDataTitle()}
  description={$LL.wipeDataDescription()}
  confirmLabel={$LL.wipeData()}
  destructive
  onConfirm={() => void wipeData()}
/>
