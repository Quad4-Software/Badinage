<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  import { cn } from '$lib/utils/cn'

  interface Props extends HTMLInputAttributes {
    value?: string
  }

  let { class: className, value = $bindable(''), ...rest }: Props = $props()
</script>

<input
  bind:value
  class={cn(
    'border-input selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
    className
  )}
  {...rest}
/>
