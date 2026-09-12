<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  import { cn } from '$lib/utils/cn'

  let { class: className, ...rest }: HTMLAttributes<HTMLDivElement> = $props()
</script>

<div class={cn('bg-accent animate-pulse rounded-md', className)} {...rest}></div>
