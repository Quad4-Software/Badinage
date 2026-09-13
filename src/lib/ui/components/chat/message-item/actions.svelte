<script lang="ts">
  import { Check, Copy, Pencil, Reply, Smile, SmilePlus, Trash2, X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { copyText } from '$lib/ui/clipboard'
  import { tick } from '$lib/ui/interactions'
  import { cn } from '$lib/utils/cn'

  interface Props {
    message: ChatMessage
    canModerate?: boolean
    // picker state and positioning live in the parent because a second
    // trigger in the reaction row shares them
    pickerOpen?: boolean
    onOpenPicker?: ((anchor: 'top' | 'bottom', trigger: HTMLElement) => void) | undefined
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onRetract?: ((message: ChatMessage) => void) | undefined
    // XEP-0425: shown only when our own room role allows moderation
    onModerate?: ((message: ChatMessage) => void) | undefined
    // removes the message. Only rendered for undecryptable tombstones
    onDismiss?: ((message: ChatMessage) => void) | undefined
  }

  let {
    message,
    canModerate = false,
    pickerOpen = false,
    onOpenPicker,
    onReply,
    onEdit,
    onRetract,
    onModerate,
    onDismiss
  }: Props = $props()

  const actionClass =
    'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 items-center justify-center rounded transition-transform active:scale-90'

  let copied = $state(false)

  // success feedback is a check flash on the button itself: the write
  // happened, no toast needed
  async function copyBody() {
    if (!(await copyText(message.body))) return
    copied = true
    tick()
    setTimeout(() => (copied = false), 1200)
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
      onclick={(event) => onOpenPicker?.('top', event.currentTarget)}
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
      {#if copied}
        <Check class="text-success size-3.5" />
      {:else}
        <Copy class="size-3.5" />
      {/if}
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

  {#if Object.keys(message.reactions).length === 0}
    <button
      type="button"
      class={cn(
        'msg-hover-only bg-popover text-muted-foreground hover:text-accent-foreground absolute -bottom-3 z-10 flex size-6 items-center justify-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        message.outgoing ? 'right-1' : 'left-1'
      )}
      aria-label={$LL.react()}
      onclick={(event) => onOpenPicker?.('bottom', event.currentTarget)}
    >
      <SmilePlus class="size-3.5" />
    </button>
  {/if}
{/if}
