<script lang="ts">
  import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let {
    class: className,
    children,
    viewportRef = $bindable(null),
    ...rest
  }: ScrollAreaPrimitive.RootProps & {
    viewportRef?: HTMLDivElement | null
  } = $props()
</script>

<ScrollAreaPrimitive.Root class={cn('relative overflow-hidden', className)} {...rest}>
  <ScrollAreaPrimitive.Viewport bind:ref={viewportRef} class="size-full rounded-[inherit]">
    {@render children?.()}
  </ScrollAreaPrimitive.Viewport>
  <ScrollAreaPrimitive.Scrollbar
    orientation="vertical"
    class="flex w-2.5 touch-none border-l border-l-transparent p-px transition-colors select-none"
  >
    <ScrollAreaPrimitive.Thumb class="bg-border relative flex-1 rounded-full" />
  </ScrollAreaPrimitive.Scrollbar>
  <ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
