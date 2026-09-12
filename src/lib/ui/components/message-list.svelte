<script lang="ts">
  import { locale } from '$lib/i18n/i18n-svelte'
  import type { ChatMessage, Conversation } from '$lib/state/chats.svelte'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { parseJid } from '$lib/utils/jid'
  import { formatDay, isSameDay } from '$lib/utils/time'

  import MessageItem from './message-item.svelte'

  interface Props {
    conversation: Conversation
    // our own bare jid (dm) - used to mark our reaction pills
    selfJid?: string
    onQuoteClick?: ((id: string) => void) | undefined
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onReact?: ((message: ChatMessage, emoji: string) => void) | undefined
  }

  let { conversation, selfJid = '', onQuoteClick, onReply, onEdit, onReact }: Props = $props()

  const GROUP_GAP_MS = 5 * 60 * 1000

  let viewport = $state<HTMLDivElement | null>(null)

  // in a muc, our reaction sender entry is our nick rather than our jid
  const self = $derived(conversation.kind === 'muc' ? (conversation.ourNick ?? selfJid) : selfJid)

  // a new visual group starts on a different sender, a day separator,
  // or a gap of more than five minutes
  function startsGroup(index: number): boolean {
    const message = conversation.messages[index]
    const prev = conversation.messages[index - 1]
    if (!message || !prev) return true
    if (!isSameDay(prev.timestamp, message.timestamp)) return true
    if (message.timestamp - prev.timestamp > GROUP_GAP_MS) return true
    return prev.outgoing !== message.outgoing || prev.nick !== message.nick
  }

  function avatarName(message: ChatMessage): string {
    return message.nick ?? parseJid(message.peerJid).local ?? message.peerJid
  }

  $effect(() => {
    const _count = conversation.messages.length
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  })

  // images and other async content grow the list after the initial scroll;
  // stay pinned to the bottom whenever we were already there
  let pinned = true
  $effect(() => {
    const el = viewport
    if (!el) return
    const onScroll = () => {
      pinned = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
    }
    el.addEventListener('scroll', onScroll)
    const observer = new ResizeObserver(() => {
      if (pinned) el.scrollTop = el.scrollHeight
    })
    for (const child of el.children) observer.observe(child)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  })
</script>

<ScrollArea bind:viewportRef={viewport} class="flex-1">
  <ol class="flex flex-col p-4">
    {#each conversation.messages as message, i (message.id)}
      {@const grouped = startsGroup(i)}
      {#if i === 0 || !isSameDay(message.timestamp, conversation.messages[i - 1]?.timestamp ?? 0)}
        <li class="text-muted-foreground my-3 text-center text-xs" aria-hidden="true">
          {formatDay(message.timestamp, $locale)}
        </li>
      {/if}
      <li id={`m-${message.id}`} class={i > 0 ? (grouped ? 'mt-3' : 'mt-0.5') : ''}>
        <MessageItem
          {message}
          showNick={grouped}
          showAvatar={grouped}
          avatarName={avatarName(message)}
          selfJid={self}
          {onQuoteClick}
          {onReply}
          {onEdit}
          onReact={onReact ? (emoji) => onReact(message, emoji) : undefined}
        />
      </li>
    {/each}
  </ol>
</ScrollArea>
