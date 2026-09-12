<script lang="ts">
  import { app } from '$lib/state/app.svelte'
  import { cn } from '$lib/utils/cn'

  import ChatSidebar from './chat-sidebar.svelte'
  import ChatView from './chat-view.svelte'
</script>

<div class="flex h-full">
  <aside
    class={cn(
      'bg-card w-full border-r md:flex md:w-80 md:shrink-0',
      app.activePeer ? 'hidden' : 'flex'
    )}
  >
    <ChatSidebar />
  </aside>
  <main class={cn('min-w-0 flex-1 md:block', app.activePeer ? 'block' : 'hidden')}>
    <ChatView />
  </main>
</div>
