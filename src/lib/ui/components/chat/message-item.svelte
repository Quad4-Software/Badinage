<script lang="ts">
  import { Copy, Lock, Pencil, Reply, Smile, SmilePlus, Trash2 } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { Avatar, AvatarFallback } from '$lib/ui/primitives/avatar'
  import { cn } from '$lib/utils/cn'
  import { isEmojiOnly } from '$lib/utils/emoji'

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
    // XEP-0425: shown only when our own room role allows moderation
    canModerate?: boolean
    onModerate?: ((message: ChatMessage) => void) | undefined
    // maps a reaction sender key (occupant id or nick) to a display
    // name; identity when absent
    senderLabel?: ((key: string) => string) | undefined
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
    onReact,
    canModerate = false,
    onModerate,
    senderLabel = (key: string) => key
  }: Props = $props()

  let pickerOpen = $state(false)
  let pickerAnchor = $state<'top' | 'bottom'>('top')

  const URL_RE = /(https?:\/\/\S+)/g
  const isUrl = (part: string) => /^https?:\/\/\S+$/.test(part)

  // senders put the oob url in the body as a fallback; when the body is
  // exactly that url the attachment block already renders it
  const bodyIsAttachmentUrl = $derived(
    (message.attachments ?? []).some((a) => a.url === message.body.trim())
  )
  const bodyParts = $derived(bodyIsAttachmentUrl ? [] : message.body.split(URL_RE))
  const reactionEntries = $derived(Object.entries(message.reactions))
  const jumbo = $derived(isEmojiOnly(message.body))
  const initials = $derived((avatarName || message.nick || '?').slice(0, 2))

  const actionClass =
    'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 items-center justify-center rounded'

  function copyBody() {
    void navigator.clipboard?.writeText(message.body).catch(() => undefined)
  }

  // anchor follows the trigger: the action bar sits above the bubble, the
  // quick-react buttons below it
  function openPicker(anchor: 'top' | 'bottom') {
    pickerAnchor = anchor
    pickerOpen = !pickerOpen
  }
</script>

{#if message.retracted}
  <!-- XEP-0424/0425 tombstone: body and attachments are gone, only the
       placeholder remains -->
  <div class={cn('flex items-end gap-2', message.outgoing && 'justify-end')}>
    <p class="text-muted-foreground text-sm italic">
      {$LL.messageRemoved()}{message.retractReason ? ` · ${message.retractReason}` : ''}
    </p>
  </div>
{:else}
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
      class={cn(
        'flex max-w-[75%] min-w-0 flex-col',
        message.outgoing ? 'items-end' : 'items-start'
      )}
    >
      {#if showNick && !message.outgoing && message.nick}
        <span class="text-muted-foreground mb-0.5 ml-1 text-xs">{message.nick}</span>
      {/if}

      <div class="relative max-w-full">
        <div
          class={cn(
            'density-text-sm rounded-2xl px-3 py-[var(--density-row-pad)]',
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
                    message.outgoing ? 'text-primary-foreground/70' : 'text-foreground/70'
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

          {#if message.undecryptable}
            <p
              class={cn(
                'flex items-center gap-1.5 italic',
                message.outgoing ? 'text-primary-foreground/70' : 'text-foreground/70'
              )}
            >
              <Lock class="size-3.5 shrink-0" />
              {$LL.couldNotDecrypt()}
            </p>
          {:else if message.body && !bodyIsAttachmentUrl}
            <p class={cn('break-words whitespace-pre-wrap', jumbo && 'text-4xl leading-tight')}>
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
            'bg-popover absolute right-1 bottom-full z-10 mb-0.5 flex items-center gap-0.5 rounded-md border p-0.5 shadow-sm transition-opacity',
            pickerOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
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
            onclick={() => openPicker('top')}
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
          <button
            type="button"
            class={actionClass}
            aria-label={$LL.copyMessage()}
            onclick={copyBody}
          >
            <Copy class="size-3.5" />
          </button>
          {#if canModerate}
            <button
              type="button"
              class={actionClass}
              aria-label={$LL.removeMessage()}
              onclick={() => onModerate?.(message)}
            >
              <Trash2 class="size-3.5" />
            </button>
          {/if}
        </div>

        {#if pickerOpen}
          <div
            class={cn(
              'absolute z-30',
              pickerAnchor === 'top'
                ? 'right-0 bottom-full mb-1'
                : cn('top-full mt-1', message.outgoing ? 'right-0' : 'left-0')
            )}
          >
            <EmojiPicker
              onPick={(emoji) => onReact?.(emoji)}
              onClose={() => (pickerOpen = false)}
            />
          </div>
        {/if}

        {#if reactionEntries.length === 0}
          <button
            type="button"
            class={cn(
              'bg-popover text-muted-foreground hover:text-accent-foreground absolute -bottom-3 z-10 flex size-6 items-center justify-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
              message.outgoing ? 'right-1' : 'left-1'
            )}
            aria-label={$LL.react()}
            onclick={() => openPicker('bottom')}
          >
            <SmilePlus class="size-3.5" />
          </button>
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
              title={senders.map(senderLabel).join(', ')}
              aria-pressed={mine}
              onclick={() => onReact?.(emoji)}
            >
              <span>{emoji}</span>
              <span class="tabular-nums">{senders.length}</span>
            </button>
          {/each}
          <button
            type="button"
            class="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 items-center justify-center rounded-full border border-dashed opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={$LL.react()}
            onclick={() => openPicker('bottom')}
          >
            <SmilePlus class="size-3.5" />
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
