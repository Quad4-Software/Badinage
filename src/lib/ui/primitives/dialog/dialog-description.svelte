<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let { class: className, children, ...rest }: DialogPrimitive.DescriptionProps = $props()
</script>

<DialogPrimitive.Description class={cn('text-muted-foreground text-sm', className)} {...rest}>
  {@render children?.()}
</DialogPrimitive.Description>
