<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui'
  import { X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { cn } from '$lib/utils/cn'

  let { class: className, children, ...rest }: DialogPrimitive.ContentProps = $props()
</script>

<DialogPrimitive.Portal>
  <DialogPrimitive.Overlay
    class="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
  />
  <DialogPrimitive.Content
    class={cn(
      'bg-background fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
      className
    )}
    {...rest}
  >
    {@render children?.()}
    <DialogPrimitive.Close
      class="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      aria-label={$LL.close()}
    >
      <X class="size-4" />
    </DialogPrimitive.Close>
  </DialogPrimitive.Content>
</DialogPrimitive.Portal>
