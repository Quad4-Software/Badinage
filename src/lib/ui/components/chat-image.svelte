<script lang="ts">
  import { cn } from '$lib/utils/cn'

  interface Props {
    src: string
    alt: string
    mediaType?: string | undefined
    class?: string
  }

  let { src, alt, mediaType, class: className }: Props = $props()

  // only formats that can animate get an observer; freezing a static
  // image would just double its memory for no gain
  const canAnimate = $derived(!mediaType || /^image\/(gif|webp|apng|avif)$/i.test(mediaType))

  let img = $state<HTMLImageElement | null>(null)
  let canvas = $state<HTMLCanvasElement | null>(null)
  let frozen = $state(false)

  // draw the frame the img is currently showing, then swap visibility so
  // the browser stops painting the animation while it is off screen
  function freeze() {
    if (!img || !canvas || !img.complete || img.naturalWidth === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    try {
      // cross-origin sources paint fine here; the canvas is tainted but
      // we never read pixels back
      ctx.drawImage(img, 0, 0)
      frozen = true
    } catch {
      // drawImage can throw on broken sources; keep the img visible
      frozen = false
    }
  }

  function unfreeze() {
    frozen = false
    // drop the frozen frame so it does not sit in memory while visible
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }

  $effect(() => {
    const el = img
    if (!el || !canAnimate || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) unfreeze()
      else freeze()
    })
    observer.observe(el)
    return () => observer.disconnect()
  })
</script>

<span class="relative inline-block max-w-full">
  <img
    bind:this={img}
    {src}
    {alt}
    loading="lazy"
    decoding="async"
    class={cn(className, frozen && 'invisible')}
  />
  <canvas
    bind:this={canvas}
    aria-hidden="true"
    class={cn('absolute inset-0 h-full w-full', className, !frozen && 'hidden')}
  ></canvas>
</span>
