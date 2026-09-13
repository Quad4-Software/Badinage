<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { wipeAllData } from '$lib/state/storage'
  import { Button } from '$lib/ui/primitives/button'

  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import { matchesQuery } from './match'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  let confirmWipe = $state(false)

  async function wipeData() {
    sessionStorage.clear()
    localStorage.clear()
    await wipeAllData()
    location.reload()
  }
</script>

<SettingSection
  id="danger"
  title={$LL.dangerZone()}
  titleClass="text-destructive text-sm font-medium"
  visible={matchesQuery(q, $LL.dangerZone(), $LL.wipeData())}
>
  <div class="flex items-center justify-between gap-4">
    <p class="text-muted-foreground text-xs">{$LL.wipeDataHint()}</p>
    <Button variant="destructive" size="sm" onclick={() => (confirmWipe = true)}>
      {$LL.wipeData()}
    </Button>
  </div>
</SettingSection>

<ConfirmDialog
  bind:open={confirmWipe}
  title={$LL.wipeDataTitle()}
  description={$LL.wipeDataDescription()}
  confirmLabel={$LL.wipeData()}
  destructive
  onConfirm={() => void wipeData()}
/>
