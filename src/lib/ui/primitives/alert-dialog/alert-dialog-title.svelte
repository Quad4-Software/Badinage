<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let { class: className, children, ...rest }: AlertDialogPrimitive.TitleProps = $props()
</script>

<AlertDialogPrimitive.Title class={cn('text-lg font-semibold', className)} {...rest}>
  {@render children?.()}
</AlertDialogPrimitive.Title>
