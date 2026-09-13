<script lang="ts">
  import { Pane, PaneGroup, PaneResizer } from 'paneforge'

  import { SHELL_PANE_AUTOSAVE_ID, SPLIT_PANE_AUTOSAVE_ID } from '$lib/constants'
  import { app } from '$lib/state/app.svelte'
  import { cn } from '$lib/utils/cn'

  import ChatSidebar from '../chat/chat-sidebar.svelte'
  import ChatView from '../chat/chat-view.svelte'
  import SidebarRail from '../chat/sidebar/sidebar-rail.svelte'

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

  type PaneHandle = ReturnType<typeof Pane>
  let sidebarPane = $state<PaneHandle | undefined>(undefined)

  const RAIL_WIDTH_PX = 56
  let windowWidth = $state(0)
  $effect(() => {
    const update = () => (windowWidth = window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  })
  // pane sizes are flex-grow weights out of 100, so the rail's pixel
  // width has to be converted to keep the collapsed pane exactly rail-wide
  const railSize = $derived(windowWidth > 0 ? Math.min(8, (RAIL_WIDTH_PX / windowWidth) * 100) : 0)

  const SIDEBAR_DEFAULT = 20

  // expandPane() only fires when paneSize === collapsedSize with strict
  // equality; collapsedSize is a float derived from window width, so after
  // a resize or restore the check fails and expand() silently no-ops.
  // isCollapsed() is tolerant, and resize() expands to any size, so it is
  // the fallback when expand() could not prove the pane was collapsed
  function toggleSidebar() {
    if (!sidebarPane) return
    if (sidebarPane.isCollapsed()) {
      sidebarPane.expand()
      if (sidebarPane.isCollapsed()) sidebarPane.resize(SIDEBAR_DEFAULT)
    } else {
      sidebarPane.collapse()
    }
  }

  $effect(() => app.registerAction('nav.toggleSidebar', toggleSidebar))
</script>

{#snippet resizer(dimmed = false)}
  <PaneResizer
    class={cn(
      'bg-border hover:bg-primary/20 data-[resize-handle-state=drag]:bg-primary/40 relative w-px transition-colors',
      dimmed && 'pointer-events-none opacity-0'
    )}
  >
    <span
      class="bg-border absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
    ></span>
  </PaneResizer>
{/snippet}

{#if !desktop}
  <div class="h-full">
    <!-- exactly one of these mains is visible at a time -->
    <main class={cn('bg-card h-full border-r', app.activePeer && 'hidden')}>
      <ChatSidebar />
    </main>
    <main class={cn('h-full min-w-0', !app.activePeer && 'hidden')}>
      <ChatView peer={app.activePeer} />
    </main>
  </div>
{:else}
  <PaneGroup
    direction="horizontal"
    class="h-full"
    autoSaveId={SHELL_PANE_AUTOSAVE_ID}
    role="main"
  >
    <Pane
      bind:this={sidebarPane}
      defaultSize={SIDEBAR_DEFAULT}
      minSize={14}
      maxSize={40}
      collapsible
      collapsedSize={railSize}
      onCollapse={() => (app.sidebarCollapsed = true)}
      onExpand={() => (app.sidebarCollapsed = false)}
      class="bg-card"
    >
      <div class="pane-rail h-full"><SidebarRail /></div>
      <div class="pane-full h-full min-w-0"><ChatSidebar /></div>
    </Pane>
    {@render resizer(app.sidebarCollapsed)}
    <Pane defaultSize={76} minSize={40} class="min-w-0">
      {#if app.splitPeer !== null}
        <PaneGroup
          direction="horizontal"
          class="h-full"
          autoSaveId={SPLIT_PANE_AUTOSAVE_ID}
        >
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
