<script lang="ts">
  import { Maximize, Pause, Play, Volume2, VolumeX } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { cn } from '$lib/utils/cn'

  let { url, name }: { url: string; name?: string | undefined } = $props()

  const SEEK_STEP = 5

  let wrap = $state<HTMLDivElement | null>(null)
  let video = $state<HTMLVideoElement | null>(null)
  let playing = $state(false)
  let elapsed = $state(0)
  let duration = $state(0)
  let muted = $state(false)
  // keep the controls visible briefly after pausing starts so the overlay
  // does not flicker on every tap
  let hovering = $state(false)

  const controlsVisible = $derived(!playing || hovering)

  function formatClock(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  function toggle() {
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  function seekTo(fraction: number) {
    if (!video || duration <= 0) return
    video.currentTime = Math.min(1, Math.max(0, fraction)) * duration
    elapsed = video.currentTime
  }

  function onTrackClick(event: MouseEvent) {
    const el = event.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    seekTo((event.clientX - rect.left) / rect.width)
  }

  function onTrackKeydown(event: KeyboardEvent) {
    if (duration <= 0) return
    if (event.key === 'ArrowLeft') seekTo((elapsed - SEEK_STEP) / duration)
    else if (event.key === 'ArrowRight') seekTo((elapsed + SEEK_STEP) / duration)
    else if (event.key === 'Home') seekTo(0)
    else if (event.key === 'End') seekTo(1)
    else return
    event.preventDefault()
  }

  function fullscreen() {
    if (!wrap) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void wrap.requestFullscreen?.()
  }
</script>

<div
  bind:this={wrap}
  class="group/player relative w-fit max-w-full overflow-hidden rounded-lg bg-black"
  role="region"
  aria-label={name ?? $LL.videoAttachment()}
  onmouseenter={() => (hovering = true)}
  onmouseleave={() => (hovering = false)}
>
  <!-- chat attachments carry no caption tracks. There is nothing to point a track at -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={video}
    src={url}
    preload="metadata"
    playsinline
    class="block max-h-72 max-w-full cursor-pointer"
    onclick={toggle}
    bind:muted
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => (playing = false)}
    ontimeupdate={() => (elapsed = video?.currentTime ?? 0)}
    onloadedmetadata={() => {
      const d = video?.duration ?? 0
      duration = Number.isFinite(d) ? d : 0
    }}
  ></video>

  {#if !playing}
    <button
      type="button"
      class="absolute inset-0 flex items-center justify-center bg-black/30"
      onclick={toggle}
      aria-label={$LL.play()}
    >
      <span
        class="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-full shadow-lg"
      >
        <Play class="ml-1 size-5" />
      </span>
    </button>
  {/if}

  <div
    class={cn(
      'absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 pt-6 pb-1.5 transition-opacity',
      controlsVisible ? 'opacity-100' : 'opacity-0'
    )}
  >
    <button
      type="button"
      class="flex size-7 shrink-0 items-center justify-center rounded text-white hover:bg-white/20"
      onclick={toggle}
      aria-label={playing ? $LL.pause() : $LL.play()}
    >
      {#if playing}<Pause class="size-4" />{:else}<Play class="ml-0.5 size-4" />{/if}
    </button>

    <div
      class="flex h-7 min-w-0 flex-1 cursor-pointer items-center"
      role="slider"
      tabindex="0"
      aria-label={$LL.videoSeek()}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(elapsed)}
      aria-valuetext={`${formatClock(elapsed)} / ${formatClock(duration)}`}
      onclick={onTrackClick}
      onkeydown={onTrackKeydown}
    >
      <div class="relative h-1 w-full rounded-full bg-white/30">
        <div
          class="bg-primary absolute inset-y-0 left-0 rounded-full"
          style:width="{duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0}%"
        ></div>
      </div>
    </div>

    <span class="shrink-0 text-[0.65rem] text-white/80 tabular-nums">
      {formatClock(elapsed)} / {formatClock(duration)}
    </span>

    <button
      type="button"
      class="flex size-7 shrink-0 items-center justify-center rounded text-white hover:bg-white/20"
      onclick={() => (muted = !muted)}
      aria-label={muted ? $LL.unmute() : $LL.mute()}
    >
      {#if muted}<VolumeX class="size-4" />{:else}<Volume2 class="size-4" />{/if}
    </button>
    <button
      type="button"
      class="flex size-7 shrink-0 items-center justify-center rounded text-white hover:bg-white/20"
      onclick={fullscreen}
      aria-label={$LL.fullscreen()}
    >
      <Maximize class="size-4" />
    </button>
  </div>
</div>
