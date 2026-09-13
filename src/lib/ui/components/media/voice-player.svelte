<script lang="ts">
  import { Pause, Play } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { cn } from '$lib/utils/cn'

  let { url, duration }: { url: string; duration?: number | undefined } = $props()

  const BAR_COUNT = 32
  const SEEK_STEP = 5

  let audio = $state<HTMLAudioElement | null>(null)
  let playing = $state(false)
  let elapsed = $state(0)
  // real length once metadata loads, falls back to the hint from the stanza
  let measured = $state(0)

  // deterministic pseudo-random bars seeded from the url so every voice
  // message gets a stable fake waveform
  const bars = $derived.by(() => {
    const out: number[] = []
    for (let i = 0; i < BAR_COUNT; i++) {
      const code = url.charCodeAt(i % url.length)
      out.push(20 + ((code * 31 * (i + 1) + url.length * 17) % 81))
    }
    return out
  })

  const total = $derived(measured > 0 ? measured : (duration ?? 0))
  const progress = $derived(total > 0 ? Math.min(1, elapsed / total) : 0)

  function formatClock(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  function toggle() {
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  function seekTo(fraction: number) {
    if (total <= 0) return
    const t = Math.min(1, Math.max(0, fraction)) * total
    elapsed = t
    if (audio) audio.currentTime = t
  }

  function onWaveClick(event: MouseEvent) {
    const el = event.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    seekTo((event.clientX - rect.left) / rect.width)
  }

  function onWaveKeydown(event: KeyboardEvent) {
    if (total <= 0) return
    if (event.key === 'ArrowLeft') seekTo((elapsed - SEEK_STEP) / total)
    else if (event.key === 'ArrowRight') seekTo((elapsed + SEEK_STEP) / total)
    else if (event.key === 'Home') seekTo(0)
    else if (event.key === 'End') seekTo(1)
    else return
    event.preventDefault()
  }
</script>

<div
  class="bg-card text-card-foreground flex w-56 items-center gap-2 rounded-lg border px-2 py-1.5"
  aria-label={$LL.voiceMessage()}
>
  <button
    type="button"
    class="bg-primary text-primary-foreground hover:bg-primary/90 flex size-7 shrink-0 items-center justify-center rounded-full"
    onclick={toggle}
    aria-label={playing ? $LL.pause() : $LL.play()}
  >
    {#if playing}
      <Pause class="size-3.5" />
    {:else}
      <Play class="ml-0.5 size-3.5" />
    {/if}
  </button>

  <div
    class="flex h-8 flex-1 cursor-pointer items-center gap-0.5"
    role="slider"
    tabindex="0"
    aria-label={$LL.voiceMessage()}
    aria-valuemin={0}
    aria-valuemax={Math.round(total)}
    aria-valuenow={Math.round(elapsed)}
    aria-valuetext={`${formatClock(elapsed)} / ${formatClock(total)}`}
    onclick={onWaveClick}
    onkeydown={onWaveKeydown}
  >
    {#each bars as height, i (i)}
      <span
        class={cn(
          'w-0.5 shrink-0 rounded-full',
          i / BAR_COUNT <= progress ? 'bg-primary' : 'bg-muted-foreground/30'
        )}
        style:height="{height}%"
      ></span>
    {/each}
  </div>

  <span class="text-muted-foreground shrink-0 text-[0.65rem] tabular-nums">
    {formatClock(elapsed)} / {formatClock(total)}
  </span>

  <audio
    bind:this={audio}
    src={url}
    preload="metadata"
    class="hidden"
    ontimeupdate={() => (elapsed = audio?.currentTime ?? 0)}
    onloadedmetadata={() => {
      const d = audio?.duration ?? 0
      measured = Number.isFinite(d) ? d : 0
    }}
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => {
      playing = false
      elapsed = 0
    }}
    onerror={() => (playing = false)}
  ></audio>
</div>
