<script lang="ts">
  import { Check, CheckCheck, Lock, ShieldCheck, Timer, TriangleAlert } from '@lucide/svelte'

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
  {#if message.expiresAt !== undefined}
    <Tooltip>
      <TooltipTrigger>
        {#snippet child({ props })}
          <span {...props} class="inline-flex" role="img" aria-label={$LL.disappearing()}>
            <Timer class="size-3" />
          </span>
        {/snippet}
      </TooltipTrigger>
      <TooltipContent>{$LL.disappearing()}</TooltipContent>
    </Tooltip>
  {/if}
  {#if message.edited}
    <span>{$LL.edited()}</span>
  {/if}
  {#if message.encrypted}
    <Tooltip>
      <TooltipTrigger>
        {#snippet child({ props })}
          <span
            {...props}
            class="inline-flex"
            role="img"
            aria-label={message.untrustedDevice ? $LL.untrustedDevice() : $LL.encrypted()}
          >
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
          <span {...props} class="inline-flex" role="img" aria-label={$LL.signed()}>
            <ShieldCheck class="text-success size-3" />
          </span>
        {/snippet}
      </TooltipTrigger>
      <TooltipContent>{$LL.signed()}</TooltipContent>
    </Tooltip>
  {/if}
  <time datetime={new Date(message.timestamp).toISOString()}>
    {formatTime(message.timestamp, $locale)}
  </time>
  {#if message.outgoing}
    {#if message.deliveryError}
      <Tooltip>
        <TooltipTrigger>
          {#snippet child({ props })}
            <span
              {...props}
              class="inline-flex items-center gap-0.5"
              role="img"
              aria-label={`${$LL.deliveryFailed()}: ${message.deliveryError}`}
            >
              <TriangleAlert class="text-warning size-3" />
            </span>
          {/snippet}
        </TooltipTrigger>
        <TooltipContent>{$LL.deliveryFailed()}: {message.deliveryError}</TooltipContent>
      </Tooltip>
    {:else if message.read}
      <Tooltip>
        <TooltipTrigger>
          {#snippet child({ props })}
            <span {...props} class="inline-flex" role="img" aria-label={$LL.read()}>
              <CheckCheck class="text-success size-3" />
            </span>
          {/snippet}
        </TooltipTrigger>
        <TooltipContent>{$LL.read()}</TooltipContent>
      </Tooltip>
    {:else if message.delivered}
      <Tooltip>
        <TooltipTrigger>
          {#snippet child({ props })}
            <span {...props} class="inline-flex" role="img" aria-label={$LL.delivered()}>
              <CheckCheck class="size-3 opacity-60" />
            </span>
          {/snippet}
        </TooltipTrigger>
        <TooltipContent>{$LL.delivered()}</TooltipContent>
      </Tooltip>
    {:else}
      <Tooltip>
        <TooltipTrigger>
          {#snippet child({ props })}
            <span {...props} class="inline-flex" role="img" aria-label={$LL.sent()}>
              <Check class="size-3 opacity-60" />
            </span>
          {/snippet}
        </TooltipTrigger>
        <TooltipContent>{$LL.sent()}</TooltipContent>
      </Tooltip>
    {/if}
  {/if}
</div>
