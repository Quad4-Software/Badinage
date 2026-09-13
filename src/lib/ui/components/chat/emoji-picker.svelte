<script module lang="ts">
  import { hexcodeToEmoji } from '$lib/utils/emoji'

  interface EmojiItem {
    emoji: string
    label: string
    tags: string[]
    order: number
  }

  // the dataset is a lazy chunk. Cache the built list so reopening is instant
  let datasetPromise: Promise<EmojiItem[]> | null = null

  function loadDataset(): Promise<EmojiItem[]> {
    datasetPromise ??= import('emojibase-data/en/compact.json').then((mod) =>
      mod.default
        .map((entry) => ({
          emoji: hexcodeToEmoji(entry.hexcode),
          label: entry.label,
          tags: entry.tags ?? [],
          order: entry.order ?? Number.MAX_SAFE_INTEGER
        }))
        .sort((a, b) => a.order - b.order)
    )
    return datasetPromise
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { tick } from '$lib/ui/interactions'
  import { Input } from '$lib/ui/primitives/input'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'

  let {
    onPick,
    onClose,
    // embedded inside another dialog: drop the nested dialog role, the
    // click-away layer, and the autofocus that would pop the keyboard
    embedded = false
  }: {
    onPick: (emoji: string) => void
    onClose: () => void
    embedded?: boolean
  } = $props()

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
    '😍',
    '😅',
    '🤷',
    '🎊',
    '👋',
    '💯',
    '⭐',
    '💪',
    '✨'
  ]

  const MAX_RESULTS = 200

  let all = $state<EmojiItem[]>([])
  let loading = $state(true)
  let query = $state('')
  let searchRef = $state<HTMLInputElement | null>(null)
  let pickerEl = $state<HTMLDivElement | null>(null)

  const favorites = $derived(
    EMOJIS.map(
      (emoji) =>
        all.find((item) => item.emoji === emoji) ?? { emoji, label: emoji, tags: [], order: -1 }
    )
  )

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return all
    const out: EmojiItem[] = []
    for (const item of all) {
      if (
        item.label.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q))
      ) {
        out.push(item)
        if (out.length >= MAX_RESULTS) break
      }
    }
    return out
  })

  onMount(() => {
    void loadDataset()
      .then((items) => {
        all = items
        loading = false
      })
      // drop the cached promise so the next open retries the fetch
      .catch(() => {
        datasetPromise = null
      })

    if (embedded) return
    searchRef?.focus()
    // the picker is anchored to a trigger rect, so a scroll or resize
    // that moves the anchor would leave it floating detached. Scroll
    // inside the picker itself does not count
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && pickerEl?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onClose)
    }
  })

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose()
  }

  function pick(emoji: string) {
    tick()
    onPick(emoji)
    onClose()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- click-away layer, kept unfocusable so tab order stays on the emoji grid -->
{#if !embedded}
  <button
    type="button"
    tabindex="-1"
    aria-label={$LL.cancel()}
    class="fixed inset-0 z-40 cursor-default"
    onclick={onClose}
  ></button>
{/if}

<div
  bind:this={pickerEl}
  role={embedded ? undefined : 'dialog'}
  aria-label={embedded ? undefined : $LL.addReactionEmoji()}
  class="bg-popover relative z-50 w-72 rounded-lg border p-2 shadow-md"
>
  <Input
    bind:ref={searchRef}
    bind:value={query}
    placeholder={$LL.searchEmoji()}
    aria-label={$LL.searchEmoji()}
    class="h-8 text-sm"
  />
  <ScrollArea class="mt-2 h-56">
    {#if loading}
      <p class="text-muted-foreground flex h-full items-center justify-center text-sm">
        {$LL.loading()}
      </p>
    {:else}
      <div class="grid grid-cols-8">
        {#if query.trim() === ''}
          {#each favorites as item (item.emoji)}
            <button
              type="button"
              title={item.label}
              class="hover:bg-accent flex size-7 items-center justify-center rounded-md text-lg"
              onclick={() => pick(item.emoji)}
            >
              {item.emoji}
            </button>
          {/each}
        {/if}
        {#each results as item (item.emoji)}
          <button
            type="button"
            title={item.label}
            class="hover:bg-accent flex size-7 items-center justify-center rounded-md text-lg"
            onclick={() => pick(item.emoji)}
          >
            {item.emoji}
          </button>
        {/each}
      </div>
    {/if}
  </ScrollArea>
</div>
