<script lang="ts">
  import { MonitorCog, Moon, Sun } from '@lucide/svelte'
  import { setMode, userPrefersMode } from 'mode-watcher'

  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { normalizeDensity, type Density } from '$lib/utils/density'

  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  type ModeValue = 'light' | 'dark' | 'system'

  const modeOptions = $derived<[ModeValue, string, typeof Sun][]>([
    ['light', $LL.themeLight(), Sun],
    ['dark', $LL.themeDark(), Moon],
    ['system', $LL.themeSystem(), MonitorCog]
  ])

  const hues = [25, 55, 95, 145, 180, 210, 264, 300, 340]

  const densityOptions = $derived<[Density, string][]>([
    ['comfortable', $LL.densityComfortable()],
    ['compact', $LL.densityCompact()]
  ])

  let customHue = $state(settings.current.accentHue ?? 264)

  type Row = 'theme' | 'accent' | 'density'

  const rows = $derived(
    (
      [
        ['theme', $LL.theme(), 'light dark system mode color'],
        ['accent', $LL.accentColor(), 'color colour hue tint', $LL.accentHue()],
        ['density', $LL.density(), 'compact comfortable spacing size', $LL.densityCompact()]
      ] as [Row, string, ...string[]][]
    ).filter(([, label, ...keywords]) => matchesQuery(q, label, ...keywords, $LL.appearance()))
  )

  $effect(() => {
    settingsSearch.hits.appearance = rows.length
    return () => {
      delete settingsSearch.hits.appearance
    }
  })
</script>

<SettingSection id="appearance" title={$LL.appearance()} visible={rows.length > 0}>
  {#each rows as [row] (row)}
    {#if row === 'theme'}
      <div class="flex items-center justify-between gap-4 text-sm">
        <span>{$LL.theme()}</span>
        <div class="flex gap-1 rounded-lg border p-1" role="group" aria-label={$LL.theme()}>
          {#each modeOptions as [value, label, Icon] (value)}
            {@const selected = userPrefersMode.current === value}
            <button
              type="button"
              class="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs {selected
                ? 'bg-accent'
                : 'hover:bg-accent/50'}"
              aria-pressed={selected}
              onclick={() => setMode(value)}
            >
              <Icon class="size-3.5" />
              {label}
            </button>
          {/each}
        </div>
      </div>
    {:else if row === 'density'}
      {@const current = normalizeDensity(settings.current.density)}
      <div class="flex items-center justify-between gap-4 text-sm">
        <span>{$LL.density()}</span>
        <div class="flex gap-1 rounded-lg border p-1" role="radiogroup" aria-label={$LL.density()}>
          {#each densityOptions as [value, label] (value)}
            {@const selected = current === value}
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              class="cursor-pointer rounded-md px-2 py-1 text-xs {selected
                ? 'bg-accent'
                : 'hover:bg-accent/50'}"
              onclick={() => settings.set('density', value)}
            >
              {label}
            </button>
          {/each}
        </div>
      </div>
    {:else}
      {@const activeHue = settings.current.accentHue}
      <div class="flex flex-col gap-2 text-sm">
        <span>{$LL.accentColor()}</span>
        <div role="group" aria-label={$LL.accentColor()} class="flex flex-wrap gap-2">
          <button
            type="button"
            class="bg-primary ring-primary ring-offset-background size-7 cursor-pointer rounded-full {activeHue ===
            null
              ? 'ring-2 ring-offset-2'
              : ''}"
            aria-pressed={activeHue === null}
            aria-label={$LL.resetBinding()}
            onclick={() => settings.set('accentHue', null)}
          ></button>
          {#each hues as hue (hue)}
            {@const selected = activeHue === hue}
            <button
              type="button"
              class="ring-primary ring-offset-background size-7 cursor-pointer rounded-full {selected
                ? 'ring-2 ring-offset-2'
                : ''}"
              style={`background: oklch(0.65 0.17 ${hue})`}
              aria-pressed={selected}
              aria-label="{$LL.accentColor()} {hue}"
              onclick={() => {
                customHue = hue
                settings.set('accentHue', hue)
              }}
            ></button>
          {/each}
        </div>
      </div>
      <label class="flex flex-col gap-2 text-sm">
        <span class="flex items-center justify-between gap-4">
          {$LL.accentHue()}
          <span
            class="size-5 shrink-0 rounded-full"
            style={`background: oklch(0.65 0.17 ${customHue})`}
          ></span>
        </span>
        <input
          type="range"
          min="0"
          max="360"
          step="1"
          class="accent-primary w-full"
          bind:value={customHue}
          oninput={() => settings.set('accentHue', Number(customHue))}
        />
      </label>
    {/if}
  {/each}
</SettingSection>
