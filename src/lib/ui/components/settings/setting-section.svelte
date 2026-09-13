<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    id: string
    title: string
    // sections hide themselves when a search leaves them with no rows
    visible?: boolean
    titleClass?: string
    children?: Snippet
  }

  let { id, title, visible = true, titleClass, children }: Props = $props()
</script>

{#if visible}
  <section data-section={id} aria-label={title} class="flex flex-col gap-3 px-5 py-4">
    <h3 class={titleClass ?? 'text-sm font-medium'}>{title}</h3>
    {@render children?.()}
  </section>
{/if}
