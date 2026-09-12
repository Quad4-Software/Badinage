<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'

  let { onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void } = $props()

  const EMOJIS = [
    '👍',
    '❤️',
    '😂',
    '😮',
    '😢',
    '🔥',
    '🎉',
    '👀',
    '👌',
    '👎',
    '✅',
    '🙏',
    '👏',
    '🤔',
    '🚀',
    '�',
    '�',
    '😍',
    '🎊',
    '👋',
    '💯',
    '⭐',
    '💪',
    '✨'
  ]

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose()
  }

  function pick(emoji: string) {
    onPick(emoji)
    onClose()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- click-away layer, kept unfocusable so tab order stays on the emoji grid -->
<button
  type="button"
  tabindex="-1"
  aria-label={$LL.cancel()}
  class="fixed inset-0 z-40 cursor-default"
  onclick={onClose}
></button>

<div
  role="dialog"
  aria-label={$LL.addReactionEmoji()}
  class="bg-popover relative z-50 grid w-56 grid-cols-6 gap-0.5 rounded-lg border p-2 shadow-md"
>
  {#each EMOJIS as emoji (emoji)}
    <button
      type="button"
      class="hover:bg-accent flex size-8 items-center justify-center rounded-md text-lg"
      onclick={() => pick(emoji)}
    >
      {emoji}
    </button>
  {/each}
</div>
