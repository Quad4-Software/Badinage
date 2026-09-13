<script lang="ts">
  import { Copy, Pencil, Reply, SmilePlus, Trash2, X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { copyText } from '$lib/ui/clipboard'
  import { Sheet } from '$lib/ui/primitives/sheet'

  import EmojiPicker from '../emoji-picker.svelte'

  // the touch-first message menu: a quick reaction strip on top of the
  // same actions the desktop hover bar exposes
  interface Props {
    open?: boolean
    message: ChatMessage | null
    canModerate?: boolean
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onReact?: ((message: ChatMessage, emoji: string) => void) | undefined
    onRetract?: ((message: ChatMessage) => void) | undefined
    onModerate?: ((message: ChatMessage) => void) | undefined
    onDismiss?: ((message: ChatMessage) => void) | undefined
  }

  let {
    open = $bindable(false),
    message,
    canModerate = false,
    onReply,
    onEdit,
    onReact,
    onRetract,
    onModerate,
    onDismiss
  }: Props = $props()

  const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏']

  let pickerOpen = $state(false)

  // closing resets the expanded picker so the sheet reopens compact
  $effect(() => {
    if (!open) pickerOpen = false
  })

  function act(fn: ((message: ChatMessage) => void) | undefined) {
    if (message) fn?.(message)
    open = false
  }

  function react(emoji: string) {
    if (message) onReact?.(message, emoji)
    open = false
  }

  function copyBody() {
    if (message) void copyText(message.body)
    open = false
  }

  const rowClass =
    'hover:bg-accent hover:text-accent-foreground flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm'
</script>

<Sheet bind:open title={$LL.messageActions()}>
  {#if message && !message.retracted && !message.pending}
    <div class="flex items-center justify-between gap-1 pb-2">
      {#each QUICK as emoji (emoji)}
        <button
          type="button"
          class="hover:bg-accent flex size-10 items-center justify-center rounded-full text-xl"
          aria-label={$LL.react()}
          onclick={() => react(emoji)}
        >
          {emoji}
        </button>
      {/each}
      <button
        type="button"
        class="hover:bg-accent text-muted-foreground flex size-10 items-center justify-center rounded-full"
        aria-label={$LL.addReactionEmoji()}
        aria-expanded={pickerOpen}
        onclick={() => (pickerOpen = !pickerOpen)}
      >
        <SmilePlus class="size-5" />
      </button>
    </div>

    {#if pickerOpen}
      <div class="flex justify-center pb-2">
        <EmojiPicker embedded onPick={react} onClose={() => (pickerOpen = false)} />
      </div>
    {/if}

    <div class="flex flex-col">
      <button type="button" class={rowClass} onclick={() => act(onReply)}>
        <Reply class="size-4" />
        {$LL.reply()}
      </button>
      <button type="button" class={rowClass} onclick={copyBody}>
        <Copy class="size-4" />
        {$LL.copyMessage()}
      </button>
      {#if message.outgoing}
        <button type="button" class={rowClass} onclick={() => act(onEdit)}>
          <Pencil class="size-4" />
          {$LL.editMessage()}
        </button>
        <button type="button" class="{rowClass} text-destructive" onclick={() => act(onRetract)}>
          <Trash2 class="size-4" />
          {$LL.retractMessage()}
        </button>
      {/if}
      {#if canModerate}
        <button type="button" class="{rowClass} text-destructive" onclick={() => act(onModerate)}>
          <Trash2 class="size-4" />
          {$LL.removeMessage()}
        </button>
      {/if}
      {#if message.undecryptable && onDismiss}
        <button type="button" class={rowClass} onclick={() => act(onDismiss)}>
          <X class="size-4" />
          {$LL.dismissMessage()}
        </button>
      {/if}
    </div>
  {/if}
</Sheet>
