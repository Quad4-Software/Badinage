<script lang="ts">
  import { ChevronDown } from '@lucide/svelte'
  import type { Snippet } from 'svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { settings } from '$lib/state/settings.svelte'

  interface Props {
    id: string
    title: string
    // sections hide themselves when a search leaves them with no rows
    visible?: boolean
    // an active search expands every section so hits stay reachable
    forceOpen?: boolean
    titleClass?: string
    children?: Snippet
  }

  let { id, title, visible = true, forceOpen = false, titleClass, children }: Props = $props()

  const collapsed = $derived(!forceOpen && settings.current.collapsedSections.includes(id))
</script>

{#if visible}
  <section data-section={id} aria-label={title} class="flex flex-col gap-3 px-5 py-4">
    <h3 class={titleClass ?? 'text-sm font-medium'}>
      <button
        type="button"
        class="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
        aria-expanded={!collapsed}
        aria-controls={`settings-body-${id}`}
        aria-label={collapsed ? $LL.expandSection({ title }) : $LL.collapseSection({ title })}
        onclick={() => settings.toggleCollapsed(id)}
      >
        {title}
        <ChevronDown
          class="text-muted-foreground size-4 shrink-0 transition-transform {collapsed
            ? '-rotate-90'
            : ''}"
        />
      </button>
    </h3>
    {#if !collapsed}
      <div id={`settings-body-${id}`} class="flex flex-col gap-3">
        {@render children?.()}
      </div>
    {/if}
  </section>
{/if}
