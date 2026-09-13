<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui'
  import type { Snippet } from 'svelte'

  import { cn } from '$lib/utils/cn'

  // bottom sheet: a dialog anchored to the bottom edge for touch
  // ergonomics. The grabber is decorative; escape and scrim taps close.
  let {
    open = $bindable(false),
    title,
    class: className,
    children
  }: {
    open?: boolean
    // rendered sr-only so the sheet keeps an accessible name
    title: string
    class?: string
    children?: Snippet
  } = $props()
</script>

<DialogPrimitive.Root bind:open>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      class="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
    />
    <DialogPrimitive.Content
      class={cn(
        'bg-background fixed inset-x-0 bottom-0 z-50 max-h-[80%] overflow-y-auto rounded-t-2xl border-t p-4 shadow-lg',
        'sm:right-auto sm:left-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:rounded-b-2xl sm:border',
        'pb-[max(1rem,env(safe-area-inset-bottom))]',
        'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
        'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
        className
      )}
    >
      <DialogPrimitive.Title class="sr-only">{title}</DialogPrimitive.Title>
      <div class="bg-muted mx-auto mb-3 h-1 w-8 rounded-full" aria-hidden="true"></div>
      {@render children?.()}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
