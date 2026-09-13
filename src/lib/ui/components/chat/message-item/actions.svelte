<script lang="ts">
  import { Copy, Pencil, Reply, Smile, SmilePlus, Trash2, X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { copyText } from '$lib/ui/clipboard'
  import { cn } from '$lib/utils/cn'

  import EmojiPicker from '../emoji-picker.svelte'

  interface Props {
    message: ChatMessage
    canModerate?: boolean
    // picker state lives in the parent because a second trigger in the
    // reaction row shares it
    pickerOpen?: boolean
    pickerAnchor?: 'top' | 'bottom'
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onReact?: ((emoji: string) => void) | undefined
    onRetract?: ((message: ChatMessage) => void) | undefined
    // XEP-0425: shown only when our own room role allows moderation
    onModerate?: ((message: ChatMessage) => void) | undefined
    // removes the message; only rendered for undecryptable tombstones
    onDismiss?: ((message: ChatMessage) => void) | undefined
  }

  let {
    message,
    canModerate = false,
    pickerOpen = $bindable(false),
    pickerAnchor = $bindable('top'),
    onReply,
    onEdit,
    onReact,
    onRetract,
    onModerate,
    onDismiss
  }: Props = $props()

  const actionClass =
    'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 items-center justify-center rounded'

  function copyBody() {
    void copyText(message.body)
  }

  // anchor follows the trigger: the action bar sits above the bubble, the
  // quick-react buttons below it
  function openPicker(anchor: 'top' | 'bottom') {
    pickerAnchor = anchor
    pickerOpen = !pickerOpen
  }
</script>

{#if !message.retracted && !message.pending}
  <div
    class={cn(
      'msg-hover-only bg-popover absolute right-1 bottom-full z-10 mb-0.5 flex items-center gap-0.5 rounded-md border p-0.5 shadow-sm transition-opacity',
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
    <button type="button" class={actionClass} aria-label={$LL.copyMessage()} onclick={copyBody}>
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
    {#if message.undecryptable && onDismiss}
      <button
        type="button"
        class={actionClass}
        aria-label={$LL.dismissMessage()}
        onclick={() => onDismiss(message)}
      >
        <X class="size-3.5" />
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
      <EmojiPicker onPick={(emoji) => onReact?.(emoji)} onClose={() => (pickerOpen = false)} />
    </div>
  {/if}

  {#if Object.keys(message.reactions).length === 0}
    <button
      type="button"
      class={cn(
        'msg-hover-only bg-popover text-muted-foreground hover:text-accent-foreground absolute -bottom-3 z-10 flex size-6 items-center justify-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        message.outgoing ? 'right-1' : 'left-1'
      )}
      aria-label={$LL.react()}
      onclick={() => openPicker('bottom')}
    >
      <SmilePlus class="size-3.5" />
    </button>
  {/if}
{/if}
