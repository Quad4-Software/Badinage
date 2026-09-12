<script lang="ts">
  import { Pane, PaneGroup, PaneResizer } from 'paneforge'

  import { app } from '$lib/state/app.svelte'
  import { cn } from '$lib/utils/cn'

  import ChatSidebar from './chat-sidebar.svelte'
  import ChatView from './chat-view.svelte'

  // mount only the matching layout so hidden duplicates do not end up in
  // the DOM (a11y, axe, duplicate ids)
  let desktop = $state(false)
  $effect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => (desktop = mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })
</script>

{#snippet resizer()}
  <PaneResizer
    class="bg-border hover:bg-primary/20 data-[resize-handle-state=drag]:bg-primary/40 relative w-px transition-colors"
  >
    <span
      class="bg-border absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
    ></span>
  </PaneResizer>
{/snippet}

{#if !desktop}
  <div class="h-full">
    <aside class={cn('bg-card h-full border-r', app.activePeer && 'hidden')}>
      <ChatSidebar />
    </aside>
    <main class={cn('h-full min-w-0', !app.activePeer && 'hidden')}>
      <ChatView peer={app.activePeer} />
    </main>
  </div>
{:else}
  <PaneGroup direction="horizontal" class="h-full" autoSaveId="badinage-shell">
    <Pane defaultSize={24} minSize={16} maxSize={40} class="bg-card">
      <ChatSidebar />
    </Pane>
    {@render resizer()}
    <Pane defaultSize={76} minSize={40} class="min-w-0">
      {#if app.splitPeer !== null}
        <PaneGroup direction="horizontal" class="h-full" autoSaveId="badinage-split">
          <Pane defaultSize={55} minSize={30} class="min-w-0">
            <ChatView peer={app.activePeer} />
          </Pane>
          {@render resizer()}
          <Pane defaultSize={45} minSize={30} class="min-w-0 border-l">
            <ChatView peer={app.splitPeer || null} split />
          </Pane>
        </PaneGroup>
      {:else}
        <ChatView peer={app.activePeer} />
      {/if}
    </Pane>
  </PaneGroup>
{/if}
