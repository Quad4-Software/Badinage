<script lang="ts">
  import { Check, CheckCheck, Lock, ShieldCheck } from '@lucide/svelte'

  import LL, { locale } from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { cn } from '$lib/utils/cn'
  import { formatTime } from '$lib/utils/time'

  let { message }: { message: ChatMessage } = $props()
</script>

<div
  class={cn(
    'mt-0.5 flex items-center justify-end gap-1 text-[0.65rem]',
    message.outgoing ? 'text-primary-foreground/70' : 'text-foreground/70'
  )}
>
  {#if message.edited}
    <span>{$LL.edited()}</span>
  {/if}
  {#if message.encrypted}
    <Lock
      class={cn('size-3', message.untrustedDevice && 'text-warning')}
      aria-label={message.untrustedDevice ? $LL.untrustedDevice() : $LL.encrypted()}
    />
  {/if}
  {#if message.signed}
    <ShieldCheck class="text-success size-3" aria-label={$LL.signed()} />
  {/if}
  <time datetime={new Date(message.timestamp).toISOString()}>
    {formatTime(message.timestamp, $locale)}
  </time>
  {#if message.outgoing}
    {#if message.read}
      <CheckCheck class="text-success size-3" aria-label={$LL.read()} />
    {:else if message.delivered}
      <CheckCheck class="size-3 opacity-60" aria-label={$LL.delivered()} />
    {:else}
      <Check class="size-3 opacity-60" aria-label={$LL.sent()} />
    {/if}
  {/if}
</div>
