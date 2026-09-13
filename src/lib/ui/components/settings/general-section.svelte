<script lang="ts">
  import { userPrefersMode } from 'mode-watcher'

  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { notifyPermission, requestNotifyPermission } from '$lib/ui/notify'
  import { Button } from '$lib/ui/primitives/button'
  import { toast } from '$lib/ui/primitives/sonner'
  import { Switch } from '$lib/ui/primitives/switch'

  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  type Flag = 'sendWithEnter' | 'notifications' | 'sounds' | 'xmppLinkHandler'

  // tracked so the denied hint appears the moment the browser refuses
  let permission = $state(notifyPermission())
  let importEl = $state<HTMLInputElement | null>(null)

  const showBackup = $derived(
    matchesQuery(q, $LL.backupSettings(), $LL.exportSettings(), $LL.importSettings(), 'json file')
  )

  const items = $derived(
    (
      [
        ['sendWithEnter', $LL.sendWithEnter(), 'return key newline'],
        ['notifications', $LL.notifications(), 'alerts desktop notify'],
        ['sounds', $LL.sounds(), 'audio mute beep'],
        ['xmppLinkHandler', $LL.handleXmppLinks(), 'xmpp links protocol handler deep link']
      ] as [Flag, string, string][]
    ).filter(([, label, keywords]) => matchesQuery(q, label, keywords, $LL.general()))
  )

  $effect(() => {
    settingsSearch.hits.general = items.length + (showBackup ? 1 : 0)
    return () => {
      delete settingsSearch.hits.general
    }
  })

  function toggle(key: Flag, value: boolean) {
    settings.set(key, value)
    // enabling notifications is the natural moment to ask for permission:
    // the request rides a user gesture instead of firing unprompted
    if (key === 'notifications' && value) {
      void requestNotifyPermission().then((result) => (permission = result))
    }
    // the protocol handler registration also needs a user gesture; the
    // installed-pwa manifest entry works regardless of this toggle
    if (key === 'xmppLinkHandler' && value) {
      try {
        navigator.registerProtocolHandler(
          'xmpp',
          `${window.location.origin}${import.meta.env.BASE_URL}?uri=%s`
        )
      } catch {
        // scheme not allowed here (e.g. non-https); the manifest handler
        // still applies once the app is installed
      }
    }
  }

  function exportSettings() {
    const blob = new Blob([settings.exportBackup(userPrefersMode.current)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'badinage-settings.json'
    a.click()
    URL.revokeObjectURL(url)
    toast.success($LL.settingsExported())
  }

  async function importSettings(file: File | undefined) {
    if (!file) return
    // a settings file is a few kilobytes; anything bigger is not ours
    if (file.size > 256 * 1024) {
      toast.error($LL.settingsImportFailed())
      return
    }
    const result = settings.importBackup(await file.text())
    if (!result.ok) {
      toast.error($LL.settingsImportFailed())
      return
    }
    if (result.backup.mode) userPrefersMode.current = result.backup.mode
    toast.success(
      result.backup.dropped > 0
        ? $LL.settingsImportedPartial({ dropped: result.backup.dropped })
        : $LL.settingsImported()
    )
  }
</script>

<SettingSection
  id="general"
  title={$LL.general()}
  forceOpen={q !== ''}
  visible={items.length > 0 || showBackup}
>
  {#each items as [key, label] (key)}
    <div>
      <label class="flex items-center justify-between gap-4 text-sm">
        {label}
        <Switch checked={settings.current[key]} onCheckedChange={(v) => toggle(key, v)} />
      </label>
      {#if key === 'notifications' && settings.current.notifications && permission === 'denied'}
        <p class="text-muted-foreground mt-1 text-xs">{$LL.notificationsBlocked()}</p>
      {/if}
    </div>
  {/each}
  {#if showBackup}
    <div class="flex items-center justify-between gap-4 text-sm">
      <span>{$LL.backupSettings()}</span>
      <span class="flex gap-1.5">
        <Button variant="outline" size="sm" onclick={exportSettings}>
          {$LL.exportSettings()}
        </Button>
        <Button variant="outline" size="sm" onclick={() => importEl?.click()}>
          {$LL.importSettings()}
        </Button>
      </span>
      <input
        bind:this={importEl}
        type="file"
        accept="application/json,.json"
        class="hidden"
        aria-label={$LL.importSettings()}
        onchange={(e) => {
          const input = e.currentTarget
          void importSettings(input.files?.[0])
          input.value = ''
        }}
      />
    </div>
  {/if}
</SettingSection>
