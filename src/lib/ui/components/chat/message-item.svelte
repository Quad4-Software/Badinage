<script lang="ts">
  import {
    Copy,
    Eye,
    File,
    Lock,
    Pencil,
    Reply,
    Smile,
    SmilePlus,
    Trash2,
    Undo2,
    X
  } from '@lucide/svelte'

  import { REACTION_TOOLTIP_CAP } from '$lib/constants'
  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { Avatar, AvatarFallback } from '$lib/ui/primitives/avatar'
  import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/ui/primitives/tooltip'
  import { cn } from '$lib/utils/cn'
  import { isEmojiOnly } from '$lib/utils/emoji'
  import { meAction } from '$lib/utils/message-commands'
  import { reactionSenderNames } from '$lib/utils/reactions'

  import MessageAttachments from './message-attachments.svelte'
  import MessageBody from './message-body.svelte'
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
    // maps a reaction sender key (bare jid or muc nick) to a display name
    senderLabel?: ((sender: string) => string) | undefined
    onQuoteClick?: ((id: string) => void) | undefined
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onReact?: ((emoji: string) => void) | undefined
    onRetract?: ((message: ChatMessage) => void) | undefined
    onCancelUpload?: ((message: ChatMessage) => void) | undefined
  }

  let {
    message,
    showNick = false,
    showAvatar = false,
    avatarName = '',
    selfJid = '',
    senderLabel,
    onQuoteClick,
    onReply,
    onEdit,
    onReact,
    onRetract,
    onCancelUpload
  }: Props = $props()

  let pickerOpen = $state(false)
  let pickerAnchor = $state<'top' | 'bottom'>('top')
  let spoilerRevealed = $state(false)

  // senders put the oob url in the body as a fallback; when the body is
  // exactly that url the attachment block already renders it
  const bodyIsAttachmentUrl = $derived(
    (message.attachments ?? []).some((a) => a.url === message.body.trim())
  )
  const reactionEntries = $derived(Object.entries(message.reactions))
  const jumbo = $derived(isEmojiOnly(message.body))
  const initials = $derived((avatarName || message.nick || '?').slice(0, 2))
  // XEP-0245: a "/me " body renders as an italic action line
  const meText = $derived(meAction(message.body))
  const meName = $derived(message.nick ?? (message.outgoing ? $LL.you() : avatarName))
  const uploadPercent = $derived(Math.round((message.uploadProgress ?? 0) * 100))

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

  function senderNames(senders: string[]): string {
    const { names, extra } = reactionSenderNames(
      senders,
      (sender) => senderLabel?.(sender) ?? sender,
      REACTION_TOOLTIP_CAP
    )
    return extra > 0 ? [...names, $LL.moreSenders({ count: extra })].join(', ') : names.join(', ')
  }
</script>

{#snippet bodyContent()}
  {#if meText !== null}
    <p class="break-words italic">* {meName} {meText}</p>
  {:else if message.body && !bodyIsAttachmentUrl}
    {#if jumbo}
      <p class="text-4xl leading-tight break-words">{message.body}</p>
    {:else}
      <MessageBody body={message.body} unstyled={message.unstyled} />
    {/if}
  {/if}
{/snippet}

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
        {#if message.retracted}
          <!-- the row survives retraction so replies still anchor -->
          <p
            class={cn(
              'flex items-center gap-1.5 italic',
              message.outgoing ? 'text-primary-foreground/70' : 'text-foreground/70'
            )}
          >
            <Undo2 class="size-3.5 shrink-0" />
            {$LL.messageRetracted()}
          </p>
        {:else}
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

          {#if message.pending}
            <div class="flex min-w-48 items-center gap-2">
              <File class="size-4 shrink-0" />
              <div class="min-w-0 flex-1">
                <span class="block truncate">{message.pendingName ?? $LL.fileAttachment()}</span>
                <div
                  role="progressbar"
                  aria-valuenow={uploadPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={$LL.uploading()}
                  class="bg-primary-foreground/30 mt-1 h-1 rounded-full"
                >
                  <div
                    class="bg-primary-foreground h-full rounded-full transition-[width]"
                    style:width="{uploadPercent}%"
                  ></div>
                </div>
              </div>
              <button
                type="button"
                class={actionClass}
                aria-label={$LL.cancelUpload()}
                onclick={() => onCancelUpload?.(message)}
              >
                <X class="size-3.5" />
              </button>
            </div>
          {:else}
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
            {:else if message.spoilerHint !== undefined}
              <!-- XEP-0382: the body stays hidden until the reveal control -->
              <button
                type="button"
                aria-expanded={spoilerRevealed}
                class={cn(
                  'mb-1 flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs',
                  message.outgoing
                    ? 'border-primary-foreground/50'
                    : 'border-foreground/30 hover:bg-accent'
                )}
                onclick={() => (spoilerRevealed = !spoilerRevealed)}
              >
                <Eye class="size-3.5 shrink-0" />
                {message.spoilerHint || $LL.spoiler()}
              </button>
              {#if spoilerRevealed}
                {@render bodyContent()}
              {/if}
            {:else}
              {@render bodyContent()}
            {/if}
          {/if}
        {/if}

        {#if !message.pending}
          <MessageMeta {message} />
        {/if}
      </div>

      {#if !message.retracted && !message.pending}
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
            <button
              type="button"
              class={actionClass}
              aria-label={$LL.retractMessage()}
              onclick={() => onRetract?.(message)}
            >
              <Trash2 class="size-3.5" />
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
      {/if}
    </div>

    {#if reactionEntries.length > 0}
      <div class={cn('mt-1 flex flex-wrap gap-1', message.outgoing && 'justify-end')}>
        {#each reactionEntries as [emoji, senders] (emoji)}
          {@const mine = selfJid !== '' && senders.includes(selfJid)}
          <Tooltip>
            <TooltipTrigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  class={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                    mine
                      ? 'bg-primary/15 text-primary ring-primary/40 ring-1 ring-inset'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  )}
                  aria-pressed={mine}
                  onclick={() => onReact?.(emoji)}
                >
                  <span>{emoji}</span>
                  <span class="tabular-nums">{senders.length}</span>
                </button>
              {/snippet}
            </TooltipTrigger>
            <TooltipContent>{senderNames(senders)}</TooltipContent>
          </Tooltip>
        {/each}
        {#if !message.retracted && !message.pending}
          <button
            type="button"
            class="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 items-center justify-center rounded-full border border-dashed opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={$LL.react()}
            onclick={() => openPicker('bottom')}
          >
            <SmilePlus class="size-3.5" />
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
