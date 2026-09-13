<script lang="ts">
  import { CheckCheck } from '@lucide/svelte'

  import LL, { locale } from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import type { ChatMessage, Conversation } from '$lib/state/chats.svelte'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { parseJid } from '$lib/utils/jid'
  import { formatDay, isSameDay } from '$lib/utils/time'

  import LoadOlder from './load-older.svelte'
  import MessageItem from './message-item.svelte'
  import TypingIndicator from './typing-indicator.svelte'

  interface Props {
    conversation: Conversation
    // our own bare jid (dm) - used to mark our reaction pills
    selfJid?: string
    onQuoteClick?: ((id: string) => void) | undefined
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onReact?: ((message: ChatMessage, emoji: string) => void) | undefined
    // dismisses a message outright - only offered on undecryptable tombstones
    onDismiss?: ((message: ChatMessage) => void) | undefined
  }

  let {
    conversation,
    selfJid = '',
    onQuoteClick,
    onReply,
    onEdit,
    onReact,
    onDismiss
  }: Props = $props()

  const GROUP_GAP_MS = 5 * 60 * 1000
  // scrollTop under this counts as near the top and shows the pager button
  const TOP_THRESHOLD_PX = 60

  let viewport = $state<HTMLDivElement | null>(null)
  let nearTop = $state(true)
  let pinned = true
  // scrollHeight captured when an older page is requested; while set the
  // viewport is re-anchored by the prepended height as rows land so the
  // reading position does not move
  let anchorHeight: number | null = null

  // the pager only makes sense while a transport can answer it
  const canLoadOlder = $derived(accounts.active?.status === 'connected')

  // in a muc, our reaction sender entry is our nick rather than our jid
  const self = $derived(conversation.kind === 'muc' ? (conversation.ourNick ?? selfJid) : selfJid)

  const lastMessage = $derived(conversation.messages.at(-1))
  const typing = $derived(
    conversation.kind === 'muc'
      ? conversation.typers.size > 0
      : conversation.peerState === 'composing'
  )

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

  function loadOlder() {
    const account = accounts.active
    if (!account || !viewport) return
    if (conversation.historyLoading || conversation.historyComplete) return
    anchorHeight = viewport.scrollHeight
    app.chatsFor(account.jid).loadOlder(conversation, account.connection)
    // the store refused (loading, complete or offline): drop the anchor
    // so a stale height does not corrupt the next prepend
    if (!conversation.historyLoading) anchorHeight = null
  }

  // reset scroll state when the pane switches to another conversation
  $effect(() => {
    void conversation.peerJid
    pinned = true
    nearTop = true
    anchorHeight = null
  })

  $effect(() => {
    const _count = conversation.messages.length
    const el = viewport
    if (!el) return
    if (anchorHeight !== null) {
      // an older page is landing above: shift the viewport by the added
      // height so the same messages stay in view
      el.scrollTop += el.scrollHeight - anchorHeight
      anchorHeight = el.scrollHeight
      return
    }
    // stay pinned to the bottom only when the user is already there
    if (pinned) el.scrollTop = el.scrollHeight
  })

  // a page that adds no rows (empty or fully deduped) leaves nothing to
  // anchor against
  $effect(() => {
    if (!conversation.historyLoading) anchorHeight = null
  })

  // images and other async content grow the list after the initial scroll;
  // stay pinned to the bottom whenever we were already there
  $effect(() => {
    const el = viewport
    if (!el) return
    const onScroll = () => {
      pinned = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
      nearTop = el.scrollTop < TOP_THRESHOLD_PX
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
    {#if canLoadOlder}
      <LoadOlder
        loading={conversation.historyLoading ?? false}
        complete={conversation.historyComplete ?? false}
        {nearTop}
        onLoad={loadOlder}
      />
    {/if}
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
          {onDismiss}
        />
      </li>
    {/each}
    {#if typing}
      <li class="mt-3 flex items-center gap-2" aria-live="polite">
        <span class="bg-muted inline-flex items-center rounded-2xl rounded-bl-sm px-3 py-2">
          <TypingIndicator class="text-muted-foreground" />
        </span>
        {#if conversation.kind === 'muc'}
          <span class="text-muted-foreground text-xs">
            {$LL.typingNames({ names: [...conversation.typers].join(', ') })}
          </span>
        {/if}
      </li>
    {/if}
    {#if conversation.kind === 'dm' && lastMessage?.outgoing && !typing}
      <li
        class="text-muted-foreground mt-1 flex items-center justify-end gap-1 text-[0.65rem]"
        aria-live="polite"
      >
        {#if lastMessage.read}
          <CheckCheck class="text-success size-3" aria-hidden="true" />
          {$LL.seen()}
        {:else if lastMessage.delivered}
          <CheckCheck class="size-3 opacity-60" aria-hidden="true" />
          {$LL.delivered()}
        {/if}
      </li>
    {/if}
  </ol>
</ScrollArea>
