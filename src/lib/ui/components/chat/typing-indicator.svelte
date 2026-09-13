<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { cn } from '$lib/utils/cn'

  let { class: className }: { class?: string } = $props()
</script>

<span class={cn('inline-flex items-center gap-1', className)} role="img" aria-label={$LL.typing()}>
  {#each [0, 1, 2] as i (i)}
    <span class="typing-dot size-1.5 rounded-full bg-current" style:animation-delay="{i * 150}ms"
    ></span>
  {/each}
</span>
