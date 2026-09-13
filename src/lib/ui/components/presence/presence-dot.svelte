<script lang="ts">
  import { cn } from '$lib/utils/cn'

  let { presence, class: className }: { presence: string; class?: string } = $props()

  const color = $derived(
    presence === 'chat' || presence === 'online'
      ? 'bg-success'
      : presence === 'away' || presence === 'xa'
        ? 'bg-warning'
        : presence === 'dnd'
          ? 'bg-destructive'
          : 'bg-muted-foreground/40'
  )
</script>

<span
  class={cn('inline-block size-2.5 rounded-full', color, className)}
  role="img"
  aria-label={presence}
></span>
