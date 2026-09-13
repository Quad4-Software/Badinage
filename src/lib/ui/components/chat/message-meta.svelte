<script lang="ts">
  import { Check, CheckCheck, Lock, ShieldCheck } from '@lucide/svelte'

  import LL, { locale } from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/ui/primitives/tooltip'
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
    <Tooltip>
      <TooltipTrigger>
        {#snippet child({ props })}
          <span {...props} class="inline-flex">
            <Lock class={cn('size-3', message.untrustedDevice && 'text-warning')} />
          </span>
        {/snippet}
      </TooltipTrigger>
      <TooltipContent>
        {message.untrustedDevice ? $LL.untrustedDevice() : $LL.encrypted()}
      </TooltipContent>
    </Tooltip>
  {/if}
  {#if message.signed}
    <Tooltip>
      <TooltipTrigger>
        {#snippet child({ props })}
          <span {...props} class="inline-flex"><ShieldCheck class="text-success size-3" /></span>
        {/snippet}
      </TooltipTrigger>
      <TooltipContent>{$LL.signed()}</TooltipContent>
    </Tooltip>
  {/if}
  <time datetime={new Date(message.timestamp).toISOString()}>
    {formatTime(message.timestamp, $locale)}
  </time>
  {#if message.outgoing}
    {#if message.read}
      <Tooltip>
        <TooltipTrigger>
          {#snippet child({ props })}
            <span {...props} class="inline-flex"><CheckCheck class="text-success size-3" /></span>
          {/snippet}
        </TooltipTrigger>
        <TooltipContent>{$LL.read()}</TooltipContent>
      </Tooltip>
    {:else if message.delivered}
      <Tooltip>
        <TooltipTrigger>
          {#snippet child({ props })}
            <span {...props} class="inline-flex"><CheckCheck class="size-3 opacity-60" /></span>
          {/snippet}
        </TooltipTrigger>
        <TooltipContent>{$LL.delivered()}</TooltipContent>
      </Tooltip>
    {:else}
      <Tooltip>
        <TooltipTrigger>
          {#snippet child({ props })}
            <span {...props} class="inline-flex"><Check class="size-3 opacity-60" /></span>
          {/snippet}
        </TooltipTrigger>
        <TooltipContent>{$LL.sent()}</TooltipContent>
      </Tooltip>
    {/if}
  {/if}
</div>
