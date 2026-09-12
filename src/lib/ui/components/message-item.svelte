<script lang="ts">
  import { Copy, Pencil, Reply, Smile } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { Avatar, AvatarFallback } from '$lib/ui/primitives/avatar'
  import { cn } from '$lib/utils/cn'

  import MessageAttachments from './message-attachments.svelte'
  import MessageMeta from './message-meta.svelte'
  import EmojiPicker from './emoji-picker.svelte'

  interface Props {
    message: ChatMessage
    // grouping hints from message-list: true on the first bubble of a run
    showNick?: boolean
    showAvatar?: boolean
    avatarName?: string
    // bare jid (dm) or nick (muc) used to mark our own reaction pills
    selfJid?: string
    onQuoteClick?: ((id: string) => void) | undefined
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onReact?: ((emoji: string) => void) | undefined
  }

  let {
    message,
    showNick = false,
    showAvatar = false,
    avatarName = '',
    selfJid = '',
    onQuoteClick,
    onReply,
    onEdit,
    onReact
  }: Props = $props()

  let pickerOpen = $state(false)

  const URL_RE = /(https?:\/\/\S+)/g
  const isUrl = (part: string) => /^https?:\/\/\S+$/.test(part)

  const bodyParts = $derived(message.body.split(URL_RE))
  const reactionEntries = $derived(Object.entries(message.reactions))
  const initials = $derived((avatarName || message.nick || '?').slice(0, 2))

  const actionClass =
    'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 items-center justify-center rounded'

  function copyBody() {
    void navigator.clipboard?.writeText(message.body).catch(() => undefined)
  }
</script>

<div class={cn('group flex items-end gap-2', message.outgoing && 'justify-end')}>
  {#if !message.outgoing}
    {#if showAvatar}
      <Avatar class="size-7">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
    {:else}
      <!-- keeps continuation bubbles aligned under the avatar column -->
      <span class="size-7 shrink-0" aria-hidden="true"></span>
    {/if}
  {/if}

  <div
    class={cn('flex max-w-[75%] min-w-0 flex-col', message.outgoing ? 'items-end' : 'items-start')}
  >
    {#if showNick && !message.outgoing && message.nick}
      <span class="text-muted-foreground mb-0.5 ml-1 text-xs">{message.nick}</span>
    {/if}

    <div class="relative max-w-full">
      <div
        class={cn(
          'rounded-2xl px-3 py-2 text-sm',
          message.outgoing
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted rounded-bl-sm'
        )}
      >
        {#if message.replyTo}
          <button
            type="button"
            class={cn(
              'mb-1 block w-full rounded-md border-l-2 py-1 pr-1 pl-2 text-left text-xs',
              message.outgoing
                ? 'border-primary-foreground/50 bg-primary-foreground/10'
                : 'border-primary/60 bg-background/50'
            )}
            onclick={() => message.replyTo && onQuoteClick?.(message.replyTo.id)}
          >
            <span class="block truncate font-medium">{message.replyTo.from}</span>
            {#if message.replyTo.quote}
              <span
                class={cn(
                  'line-clamp-2 block',
                  message.outgoing ? 'text-primary-foreground/70' : 'text-muted-foreground'
                )}
              >
                {message.replyTo.quote}
              </span>
            {/if}
          </button>
        {/if}

        {#if message.attachments?.length}
          <div class="mb-1">
            <MessageAttachments attachments={message.attachments} />
          </div>
        {/if}

        {#if message.body}
          <p class="break-words whitespace-pre-wrap">
            {#each bodyParts as part, i (i)}
              {#if isUrl(part)}
                <a
                  href={part}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline underline-offset-2">{part}</a
                >
              {:else}{part}{/if}
            {/each}
          </p>
        {/if}

        <MessageMeta {message} />
      </div>

      <div
        class={cn(
          'bg-popover absolute -top-3 right-1 z-10 flex items-center gap-0.5 rounded-md border p-0.5 shadow-sm transition-opacity',
          pickerOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
        )}
      >
        <button
          type="button"
          class={actionClass}
          aria-label={$LL.reply()}
          onclick={() => onReply?.(message)}
        >
          <Reply class="size-3.5" />
        </button>
        <button
          type="button"
          class={actionClass}
          aria-label={$LL.react()}
          aria-expanded={pickerOpen}
          onclick={() => (pickerOpen = !pickerOpen)}
        >
          <Smile class="size-3.5" />
        </button>
        {#if message.outgoing}
          <button
            type="button"
            class={actionClass}
            aria-label={$LL.editMessage()}
            onclick={() => onEdit?.(message)}
          >
            <Pencil class="size-3.5" />
          </button>
        {/if}
        <button type="button" class={actionClass} aria-label={$LL.copyMessage()} onclick={copyBody}>
          <Copy class="size-3.5" />
        </button>
      </div>

      {#if pickerOpen}
        <div class="absolute right-0 bottom-full z-30 mb-1">
          <EmojiPicker onPick={(emoji) => onReact?.(emoji)} onClose={() => (pickerOpen = false)} />
        </div>
      {/if}
    </div>

    {#if reactionEntries.length > 0}
      <div class={cn('mt-1 flex flex-wrap gap-1', message.outgoing && 'justify-end')}>
        {#each reactionEntries as [emoji, senders] (emoji)}
          {@const mine = selfJid !== '' && senders.includes(selfJid)}
          <button
            type="button"
            class={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              mine
                ? 'bg-primary/15 text-primary ring-primary/40 ring-1 ring-inset'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            )}
            title={senders.join(', ')}
            aria-pressed={mine}
            onclick={() => onReact?.(emoji)}
          >
            <span>{emoji}</span>
            <span class="tabular-nums">{senders.length}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
