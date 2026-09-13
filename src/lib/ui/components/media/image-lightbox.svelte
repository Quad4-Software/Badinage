<script lang="ts">
  import { ExternalLink } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { Dialog, DialogContent } from '$lib/ui/primitives/dialog'

  interface Props {
    src: string
    alt: string
    onClose: () => void
  }

  let { src, alt, onClose }: Props = $props()
</script>

<Dialog open={true} onOpenChange={(o) => !o && onClose()}>
  <DialogContent
    class="w-fit max-w-[92vw] gap-2 overflow-hidden p-3 sm:max-w-[92vw]"
    aria-label={alt}
  >
    <img {src} {alt} class="max-h-[80vh] max-w-full rounded-md object-contain" />
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground min-w-0 truncate text-xs">{alt}</p>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        class="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 rounded px-2 py-1.5 text-xs"
      >
        <ExternalLink class="size-3.5" />
        {$LL.openOriginal()}
      </a>
    </div>
  </DialogContent>
</Dialog>
