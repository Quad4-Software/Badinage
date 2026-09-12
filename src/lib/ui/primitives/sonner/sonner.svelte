<script lang="ts">
  import { mode } from 'mode-watcher'
  import type { ComponentProps } from 'svelte'
  import { Toaster } from 'svelte-sonner'

  let { ...rest }: ComponentProps<typeof Toaster> = $props()
</script>

<Toaster
  theme={mode.current ?? 'system'}
  position="bottom-right"
  richColors
  closeButton
  toastOptions={{
    classes: {
      toast: 'border bg-background text-foreground shadow-lg',
      title: 'text-sm font-medium'
    }
  }}
  {...rest}
/>
