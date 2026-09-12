<script lang="ts">
  import { Check, CheckCheck } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { cn } from '$lib/utils/cn'
  import { formatTime } from '$lib/utils/time'

  let { message, showNick = false }: { message: ChatMessage; showNick?: boolean } = $props()
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
    {#if showNick && !message.outgoing && message.nick}
      <p class="text-primary mb-0.5 text-xs font-medium">{message.nick}</p>
    {/if}
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
      {#if message.outgoing}
        {#if message.read}
          <CheckCheck class="size-3" aria-label={$LL.read()} />
        {:else if message.delivered}
          <CheckCheck class="size-3 opacity-60" aria-label={$LL.delivered()} />
        {:else}
          <Check class="size-3 opacity-60" aria-label={$LL.sent()} />
        {/if}
      {/if}
    </div>
  </div>
</div>
