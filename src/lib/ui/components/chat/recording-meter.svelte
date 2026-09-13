<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'

  let { analyser }: { analyser: AnalyserNode | null } = $props()

  const BAR_COUNT = 24
  const BAR_GAP = 2

  let canvas = $state<HTMLCanvasElement | null>(null)

  $effect(() => {
    const node = analyser
    const el = canvas
    if (!node || !el) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const bins = new Uint8Array(node.frequencyBinCount)
    const color = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()

    function resize() {
      if (!el || !ctx) return
      el.width = Math.max(1, Math.round(el.clientWidth * dpr))
      el.height = Math.max(1, Math.round(el.clientHeight * dpr))
      // resizing resets the context state, restore transform and fill
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = color
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    let frame = 0
    function draw() {
      if (!el || !ctx || !node) return
      node.getByteFrequencyData(bins)
      const width = el.clientWidth
      const height = el.clientHeight
      ctx.clearRect(0, 0, width, height)
      const barWidth = Math.max(1, (width - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT)
      for (let i = 0; i < BAR_COUNT; i++) {
        const bin = Math.floor((i / BAR_COUNT) * bins.length)
        const level = (bins[bin] ?? 0) / 255
        const barHeight = Math.max(2, level * height)
        ctx.fillRect(i * (barWidth + BAR_GAP), (height - barHeight) / 2, barWidth, barHeight)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  })
</script>

{#if analyser}
  <canvas bind:this={canvas} class="h-9 w-full" aria-hidden="true"></canvas>
{:else}
  <span class="text-destructive animate-pulse px-1 text-xs font-medium" role="status">
    {$LL.recording()}
  </span>
{/if}
