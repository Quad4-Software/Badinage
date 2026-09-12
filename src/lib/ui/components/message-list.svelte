<script lang="ts">
  import type { Conversation } from '$lib/state/chats.svelte'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { formatDay, isSameDay } from '$lib/utils/time'

  import MessageItem from './message-item.svelte'

  let { conversation }: { conversation: Conversation } = $props()

  let viewport = $state<HTMLDivElement | null>(null)

  $effect(() => {
    const _count = conversation.messages.length
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  })
</script>

<ScrollArea bind:viewportRef={viewport} class="flex-1">
  <ol class="flex flex-col gap-1 p-4">
    {#each conversation.messages as message, i (message.id)}
      {#if i === 0 || !isSameDay(message.timestamp, conversation.messages[i - 1]?.timestamp ?? 0)}
        <li class="text-muted-foreground my-3 text-center text-xs" aria-hidden="true">
          {formatDay(message.timestamp, 'en')}
        </li>
      {/if}
      <li><MessageItem {message} /></li>
    {/each}
  </ol>
</ScrollArea>
