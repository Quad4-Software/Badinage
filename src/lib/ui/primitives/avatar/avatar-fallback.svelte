<script lang="ts">
  import { Avatar as AvatarPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let { class: className, ...rest }: AvatarPrimitive.FallbackProps = $props()
</script>

<AvatarPrimitive.Fallback
  class={cn(
    'bg-muted flex size-full items-center justify-center rounded-full text-xs font-medium uppercase',
    className
  )}
  {...rest}
/>
