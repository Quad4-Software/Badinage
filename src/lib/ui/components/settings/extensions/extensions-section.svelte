<script lang="ts">
  import { Puzzle, Settings2, ShieldCheck, ShieldQuestion, Trash2, Upload } from '@lucide/svelte'

  import type { InstalledExt } from '$lib/core/extensions/types'
  import LL from '$lib/i18n/i18n-svelte'
  import { extApi } from '$lib/state/app/ext-api.svelte'
  import { extensions } from '$lib/state/app/extensions.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import { Switch } from '$lib/ui/primitives/switch'

  import ConfirmDialog from '../../dialogs/confirm-dialog.svelte'
  import { matchesQuery } from '../match'
  import { settingsSearch } from '../search-state.svelte'
  import SettingSection from '../setting-section.svelte'
  import ConfigureDialog from './configure-dialog.svelte'
  import TrustDialog from './trust-dialog.svelte'

  let { q }: { q: string } = $props()

  let fileInput = $state<HTMLInputElement | null>(null)
  let installError = $state('')
  let removeTarget = $state<string | null>(null)
  let configureTarget = $state<InstalledExt | null>(null)

  const list = $derived(
    extensions.list.filter((e) =>
      matchesQuery(q, e.name, e.id, e.publisherName ?? '', $LL.extensions())
    )
  )
  const showHeader = $derived(
    matchesQuery(q, $LL.extensions(), $LL.extensionInstall(), 'plugin addon')
  )
  const hits = $derived(list.length + (showHeader ? 1 : 0))
  const visible = $derived(hits > 0)

  $effect(() => {
    settingsSearch.hits.extensions = hits
    return () => {
      delete settingsSearch.hits.extensions
    }
  })

  async function installFile(file: File) {
    installError = ''
    const result = await extensions.install(await file.text(), `file:${file.name}`)
    if (!result.ok) installError = result.error
  }
</script>

<SettingSection id="extensions" title={$LL.extensions()} {visible} forceOpen={q.length > 0}>
  {#if showHeader}
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-xs">{$LL.extensionsHint()}</p>
      <Button variant="outline" size="sm" onclick={() => fileInput?.click()}>
        <Upload class="size-3.5" />
        {$LL.extensionInstall()}
      </Button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".json,.badinage.json,application/json"
        class="hidden"
        onchange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (file) void installFile(file)
        }}
      />
    </div>
    {#if installError}
      <p class="text-destructive text-xs" role="alert">{installError}</p>
    {/if}
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-xs">{$LL.extensionUnsignedHint()}</p>
      <Switch
        checked={settings.current.allowUnsignedExtensions}
        onCheckedChange={(v) => settings.set('allowUnsignedExtensions', v)}
        aria-label={$LL.extensionAllowUnsigned()}
      />
    </div>
  {/if}

  {#each list as ext (ext.id)}
    <div class="flex items-center gap-3 rounded-md border p-3">
      <Puzzle class="text-muted-foreground size-5 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate text-sm font-medium">{ext.name}</span>
          <span class="text-muted-foreground text-xs">v{ext.version}</span>
          {#if ext.signed}
            <span
              class="text-success inline-flex items-center gap-1 text-xs"
              title={ext.keyFingerprint ?? ''}
            >
              <ShieldCheck class="size-3.5" />
              {$LL.extensionSigned()}
            </span>
          {:else}
            <span class="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <ShieldQuestion class="size-3.5" />
              {$LL.extensionUnsigned()}
            </span>
          {/if}
          {#if ext.outdated}
            <span class="text-destructive text-xs">{$LL.extensionOutdated()}</span>
          {/if}
        </div>
        <p class="text-muted-foreground truncate text-xs">
          {ext.publisherName ?? $LL.extensionUnknownPublisher()}
          {#if ext.permissions.length > 0}
            · {ext.permissions.join(', ')}
          {/if}
          {#if ext.connect.length > 0}
            · {ext.connect.join(', ')}
          {/if}
          {#if ext.errors > 0}
            · {$LL.extensionErrorCount({ count: ext.errors })}
          {/if}
        </p>
      </div>
      {#if ext.enabled && (extApi.settingFields.get(ext.id)?.length ?? 0) > 0}
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          aria-label={$LL.extensionConfigure({ name: ext.name })}
          onclick={() => (configureTarget = ext)}
        >
          <Settings2 class="size-4" />
        </Button>
      {/if}
      <Switch
        checked={ext.enabled}
        disabled={ext.outdated}
        onCheckedChange={(v) => (v ? void extensions.enable(ext.id) : extensions.disable(ext.id))}
        aria-label={$LL.extensionToggle({ name: ext.name })}
      />
      <Button
        variant="ghost"
        size="icon"
        class="text-destructive size-8"
        aria-label={$LL.extensionRemove({ name: ext.name })}
        onclick={() => (removeTarget = ext.id)}
      >
        <Trash2 class="size-4" />
      </Button>
    </div>
  {:else}
    {#if showHeader}
      <p class="text-muted-foreground text-xs">{$LL.extensionsEmpty()}</p>
    {/if}
  {/each}
</SettingSection>

<ConfirmDialog
  open={removeTarget !== null}
  title={$LL.extensionRemoveTitle()}
  description={$LL.extensionRemoveDescription()}
  confirmLabel={$LL.extensionRemoveConfirm()}
  destructive
  onConfirm={() => {
    if (removeTarget) void extensions.remove(removeTarget)
    removeTarget = null
  }}
  onOpenChange={(open) => {
    if (!open) removeTarget = null
  }}
/>

<TrustDialog />

{#if configureTarget}
  <ConfigureDialog
    ext={configureTarget}
    open={configureTarget !== null}
    onOpenChange={(v) => {
      if (!v) configureTarget = null
    }}
  />
{/if}
