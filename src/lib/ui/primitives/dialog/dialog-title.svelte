<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let { class: className, children, ...rest }: DialogPrimitive.TitleProps = $props()
</script>

<DialogPrimitive.Title class={cn('text-lg leading-none font-semibold', className)} {...rest}>
  {@render children?.()}
</DialogPrimitive.Title>
