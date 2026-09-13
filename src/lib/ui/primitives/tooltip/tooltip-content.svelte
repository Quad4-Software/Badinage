<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let {
    class: className,
    sideOffset = 4,
    children,
    ...rest
  }: TooltipPrimitive.ContentProps = $props()
</script>

<TooltipPrimitive.Portal>
  <TooltipPrimitive.Content
    {sideOffset}
    class={cn(
      'bg-primary text-primary-foreground z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance',
      'animate-in fade-in-0 zoom-in-95',
      'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      className
    )}
    {...rest}
  >
    {@render children?.()}
    <TooltipPrimitive.Arrow />
  </TooltipPrimitive.Content>
</TooltipPrimitive.Portal>
