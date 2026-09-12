<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let { class: className, children, ...rest }: AlertDialogPrimitive.DescriptionProps = $props()
</script>

<AlertDialogPrimitive.Description class={cn('text-muted-foreground text-sm', className)} {...rest}>
  {@render children?.()}
</AlertDialogPrimitive.Description>
