<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  import { cn } from '$lib/utils/cn'

  let { class: className, children, ...rest }: HTMLAttributes<HTMLElement> = $props()
</script>

<kbd
  class={cn(
    'bg-muted text-muted-foreground pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-sm px-1 font-sans text-xs font-medium select-none',
    className
  )}
  {...rest}
>
  {@render children?.()}
</kbd>
