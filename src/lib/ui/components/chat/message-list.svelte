<script lang="ts">
  import { ArrowDown, CheckCheck } from '@lucide/svelte'
  import type { SvelteComponent } from 'svelte'
  import { Virtualizer } from 'virtua/svelte'
  import type { VirtualizerHandle } from 'virtua/svelte'

  import LL, { locale } from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import type { ChatMessage, Conversation } from '$lib/state/chats.svelte'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { parseJid } from '$lib/utils/jid'
  import { formatDay } from '$lib/utils/time'

  import LoadOlder from './load-older.svelte'
  import { buildRows, itemProps, type ListRow } from './message-list/rows'
  import MessageItem from './message-item.svelte'
  import TypingRow from './message-list/typing-row.svelte'

  interface Props {
    conversation: Conversation
    // our own bare jid (dm) - used to mark our reaction pills
    selfJid?: string
    onQuoteClick?: ((id: string) => void) | undefined
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onReact?: ((message: ChatMessage, emoji: string) => void) | undefined
    // maps a reaction sender key (bare jid, nick, or occupant id) to a
    // display name. Identity when absent
    senderLabel?: ((sender: string) => string) | undefined
    onRetract?: ((message: ChatMessage) => void) | undefined
    onCancelUpload?: ((message: ChatMessage) => void) | undefined
    // XEP-0425 moderation affordance, gated on our own room role
    canModerate?: boolean
    onModerate?: ((message: ChatMessage) => void) | undefined
    // dismisses a message outright - only offered on undecryptable tombstones
    onDismiss?: ((message: ChatMessage) => void) | undefined
    // press-and-hold or right click on a bubble, for the touch sheet
    onLongPress?: ((message: ChatMessage) => void) | undefined
    // sender avatar or nick click: the key the avatar resolves under
    // (bare jid for dms, room/nick for occupants)
    onAvatarClick?: ((jid: string) => void) | undefined
  }

  let {
    conversation,
    selfJid = '',
    senderLabel,
    onQuoteClick,
    onReply,
    onEdit,
    onReact,
    onRetract,
    onCancelUpload,
    canModerate = false,
    onModerate,
    onDismiss,
    onLongPress,
    onAvatarClick
  }: Props = $props()

  // scrollTop under this counts as near the top and shows the pager button
  const TOP_THRESHOLD_PX = 60
  // this close to the bottom still counts as pinned to the tail
  const BOTTOM_THRESHOLD_PX = 40

  let viewport = $state<HTMLDivElement | null>(null)
  // virtua types its component generically so bind:this cannot carry
  // the handle shape. The exported methods are the documented handle
  let vlist = $state<SvelteComponent>()
  let nearTop = $state(true)
  let pinned = $state(true)
  // virtua compensates the scroll position on every length change while
  // the prop is set, so it stays true only while the head message
  // actually moved: prepends and head trims. A tail append compensated
  // as a prepend would jump the viewport
  let shift = $state(false)
  let lastHead: string | undefined

  // the pager only makes sense while a transport can answer it
  const canLoadOlder = $derived(accounts.active?.status === 'connected')

  // in a muc, our reaction sender entry is our XEP-0421 occupant id when
  // the room assigns one, else our nick. In a dm it is our bare jid
  const self = $derived(
    conversation.kind === 'muc'
      ? (conversation.ourOccupantId ?? conversation.ourNick ?? selfJid)
      : selfJid
  )

  const lastMessage = $derived(conversation.messages.at(-1))
  const typing = $derived(
    conversation.kind === 'muc'
      ? conversation.typers.size > 0
      : conversation.peerState === 'composing'
  )

  const rows = $derived(
    buildRows(conversation.messages, {
      typing,
      seen:
        conversation.kind === 'dm' && lastMessage?.outgoing && !typing
          ? { read: lastMessage.read, delivered: lastMessage.delivered }
          : undefined
    })
  )

  // must run before the virtualizer's own length-change effect so the
  // shift flag reflects the mutation it is about to process
  $effect.pre(() => {
    const head = conversation.messages[0]?.id
    shift = lastHead !== undefined && head !== lastHead
    lastHead = head
  })

  function avatarName(message: ChatMessage): string {
    return message.nick ?? parseJid(message.peerJid).local ?? message.peerJid
  }

  // the address an avatar is fetched under: the occupant room/nick key in
  // a room, the peer bare jid in a dm
  function avatarJid(message: ChatMessage): string {
    if (conversation.kind === 'muc') {
      return message.nick ? `${conversation.peerJid}/${message.nick}` : ''
    }
    return conversation.peerJid
  }

  function loadOlder() {
    const account = accounts.active
    if (!account || conversation.historyLoading || conversation.historyComplete) return
    // the prepended rows move the head and shift anchors the viewport
    app.chatsFor(account.jid).loadOlder(conversation, account.connection)
  }

  function scrollToLatest(smooth = false) {
    const el = viewport
    if (!el) return
    // scrollTop to scrollHeight always lands on the true bottom even
    // while row sizes are still estimates. scrollToIndex would use the
    // layout cache and land short, which reads as an unpin
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  function handle(): VirtualizerHandle | undefined {
    return vlist as VirtualizerHandle | undefined
  }

  // bring a quoted message into view even while its row is unmounted
  export function jumpTo(id: string): void {
    const index = rows.findIndex((row) => row.kind === 'message' && row.message.id === id)
    const v = handle()
    if (index < 0 || !v) return
    v.scrollToIndex(index, { align: 'center' })
    // a second pass lands the exact offset once unmeasured rows resolve
    requestAnimationFrame(() => handle()?.scrollToIndex(index, { align: 'center' }))
  }

  // the offset of the last scroll event. Scroll events dispatch after
  // the DOM grows, so a tail append can make a bottom-anchored scroll
  // read as off-bottom: only an upward move may break the pin
  let lastScrollOffset = 0

  function onScroll(offset: number) {
    const v = handle()
    if (!v) return
    const nearBottom = offset + v.getViewportSize() >= v.getScrollSize() - BOTTOM_THRESHOLD_PX
    if (nearBottom) pinned = true
    else if (offset < lastScrollOffset) pinned = false
    lastScrollOffset = offset
    nearTop = offset < TOP_THRESHOLD_PX
  }

  // land on the newest row when the pane switches to another
  // conversation. Unmeasured rows make the first landing approximate:
  // the pinned resize observer below corrects as sizes resolve
  $effect(() => {
    void conversation.peerJid
    pinned = true
    nearTop = true
    lastScrollOffset = 0
    requestAnimationFrame(() => scrollToLatest())
  })

  // keep the tail in view when rows arrive while already pinned
  $effect(() => {
    void conversation.messages.length
    if (pinned) requestAnimationFrame(() => scrollToLatest())
  })

  // media and async content grow measured rows after the initial
  // scroll. Re-pin while the user is still at the bottom
  $effect(() => {
    const el = viewport
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (pinned) scrollToLatest()
    })
    observer.observe(el)
    const content = el.firstElementChild
    if (content) observer.observe(content)
    return () => observer.disconnect()
  })
</script>

<div class="relative flex min-h-0 flex-1 flex-col">
  <ScrollArea bind:viewportRef={viewport} class="flex-1">
    <div class="p-[var(--density-list-pad)]">
      {#if canLoadOlder}
        <LoadOlder
          loading={conversation.historyLoading ?? false}
          complete={conversation.historyComplete ?? false}
          {nearTop}
          onLoad={loadOlder}
        />
      {/if}
      {#if viewport}
        <Virtualizer
          bind:this={vlist}
          data={rows}
          getKey={(row: ListRow) => row.key}
          scrollRef={viewport}
          {shift}
          {itemProps}
          onscroll={onScroll}
          as="ol"
          item="li"
        >
          {#snippet children(row: ListRow, _index: number)}
            {#if row.kind === 'day'}
              {formatDay(row.timestamp, $locale)}
            {:else if row.kind === 'message'}
              <MessageItem
                message={row.message}
                showNick={row.first}
                showAvatar={row.first}
                last={row.last}
                avatarName={avatarName(row.message)}
                {onAvatarClick}
                avatarJid={avatarJid(row.message)}
                avatarForce={conversation.kind === 'dm'}
                selfJid={self}
                {senderLabel}
                {onQuoteClick}
                {onReply}
                {onEdit}
                onReact={onReact ? (emoji) => onReact(row.message, emoji) : undefined}
                {onRetract}
                {onCancelUpload}
                {canModerate}
                onModerate={onModerate ? () => onModerate(row.message) : undefined}
                {onDismiss}
                {onLongPress}
              />
            {:else if row.kind === 'typing'}
              <TypingRow {conversation} />
            {:else if row.kind === 'seen'}
              {#if row.read}
                <CheckCheck class="text-success size-3" aria-hidden="true" />
                {$LL.seen()}
              {:else if row.delivered}
                <CheckCheck class="size-3 opacity-60" aria-hidden="true" />
                {$LL.delivered()}
              {/if}
            {/if}
          {/snippet}
        </Virtualizer>
      {/if}
    </div>
  </ScrollArea>
  {#if !pinned}
    <button
      type="button"
      aria-label={$LL.scrollToLatest()}
      class="bg-popover hover:bg-accent absolute right-3 bottom-3 z-10 flex size-10 items-center justify-center rounded-full border shadow-md"
      onclick={() => {
        pinned = true
        scrollToLatest(true)
      }}
    >
      <ArrowDown class="size-4" />
    </button>
  {/if}
</div>
