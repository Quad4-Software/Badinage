<script lang="ts">
  import { Avatar as AvatarPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let { class: className, ...rest }: AvatarPrimitive.RootProps = $props()
</script>

<AvatarPrimitive.Root
  class={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
  {...rest}
/>
