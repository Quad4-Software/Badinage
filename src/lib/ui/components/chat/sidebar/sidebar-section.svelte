<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronDown, ChevronRight } from '@lucide/svelte'

  import { cn } from '$lib/utils/cn'

  interface Props {
    title: string
    expanded?: boolean
    // the first section sits closer to the search box (mt-2 vs mt-4)
    class?: string
    // trailing icon button, e.g. add contact or join room
    action?: Snippet
    children?: Snippet
  }

  let { title, expanded = $bindable(true), class: className, action, children }: Props = $props()
</script>

<div class={cn('mt-4 flex items-center justify-between px-2 pb-1', className)}>
  <button
    class="text-muted-foreground flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    {#if expanded}<ChevronDown class="size-3.5" />{:else}<ChevronRight class="size-3.5" />{/if}
    {title}
  </button>
  <div class="flex items-center gap-0.5">
    {@render action?.()}
  </div>
</div>
{#if expanded}
  {@render children?.()}
{/if}
