<script lang="ts">
  import { Label as LabelPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let { class: className, children, ...rest }: LabelPrimitive.RootProps = $props()
</script>

<LabelPrimitive.Root
  class={cn(
    'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
    className
  )}
  {...rest}
>
  {@render children?.()}
</LabelPrimitive.Root>
