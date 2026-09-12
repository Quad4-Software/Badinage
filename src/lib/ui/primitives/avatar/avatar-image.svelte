<script lang="ts">
  import { Avatar as AvatarPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let { class: className, ...rest }: AvatarPrimitive.ImageProps = $props()
</script>

<AvatarPrimitive.Image class={cn('aspect-square size-full', className)} {...rest} />
