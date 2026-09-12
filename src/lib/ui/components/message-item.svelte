<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { cn } from '$lib/utils/cn'
  import { formatTime } from '$lib/utils/time'

  let { message }: { message: ChatMessage } = $props()
</script>

<div class={cn('flex', message.outgoing ? 'justify-end' : 'justify-start')}>
  <div
    class={cn(
      'max-w-[75%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap',
      message.outgoing
        ? 'bg-primary text-primary-foreground rounded-br-sm'
        : 'bg-muted rounded-bl-sm'
    )}
  >
    <p>{message.body}</p>
    <div
      class={cn(
        'mt-0.5 flex items-center justify-end gap-1 text-[0.65rem]',
        message.outgoing ? 'text-primary-foreground/70' : 'text-muted-foreground'
      )}
    >
      {#if message.encrypted}
        <span>{$LL.encrypted()}</span>
      {/if}
      <time datetime={new Date(message.timestamp).toISOString()}>
        {formatTime(message.timestamp, 'en')}
      </time>
    </div>
  </div>
</div>
