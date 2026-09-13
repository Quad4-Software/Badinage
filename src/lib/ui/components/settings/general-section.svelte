<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { notifyPermission, requestNotifyPermission } from '$lib/ui/notify'
  import { Switch } from '$lib/ui/primitives/switch'

  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  type Flag = 'sendWithEnter' | 'notifications' | 'sounds' | 'xmppLinkHandler'

  // tracked so the denied hint appears the moment the browser refuses
  let permission = $state(notifyPermission())

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
    settingsSearch.hits.general = items.length
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
</script>

<SettingSection id="general" title={$LL.general()} visible={items.length > 0}>
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
</SettingSection>
