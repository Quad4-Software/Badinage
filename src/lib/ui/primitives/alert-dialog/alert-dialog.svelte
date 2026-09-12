<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui'

  let { open = $bindable(false), children, ...rest }: AlertDialogPrimitive.RootProps = $props()
</script>

<AlertDialogPrimitive.Root bind:open {...rest}>
  {@render children?.()}
</AlertDialogPrimitive.Root>
