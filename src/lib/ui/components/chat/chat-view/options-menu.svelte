<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import {
    Ban,
    Bookmark as BookmarkIcon,
    BookmarkX,
    EllipsisVertical,
    Pencil,
    Quote,
    Settings,
    UserPlus,
    Zap
  } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { NotifySetting } from '$lib/core/xmpp/stanzas'
  import type { Conversation } from '$lib/state/chats.svelte'
  import { Button } from '$lib/ui/primitives/button'

  import MenuSubs from './menu-subs.svelte'

  const itemClass =
    'data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'

  let {
    conversation,
    room,
    peerBookmarked,
    peerBlocked,
    canEditSubject = false,
    canConfigure = false,
    onNick,
    onInvite,
    onSubject,
    onConfig,
    onToggleBookmark,
    onBuzz,
    onBlock,
    onSetNotify,
    onSetEphemeral
  }: {
    conversation: Conversation
    room: boolean
    peerBookmarked: boolean
    peerBlocked: boolean
    canEditSubject?: boolean
    canConfigure?: boolean
    onNick?: (() => void) | undefined
    onInvite?: (() => void) | undefined
    onSubject?: (() => void) | undefined
    onConfig?: (() => void) | undefined
    onToggleBookmark: () => void
    onBuzz?: (() => void) | undefined
    onBlock?: (() => void) | undefined
    onSetNotify: (level: NotifySetting | undefined) => void
    onSetEphemeral: (seconds: number) => void
  } = $props()
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="shrink-0">
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon"
        aria-label={room ? $LL.roomOptions() : $LL.chatOptions()}
      >
        <EllipsisVertical class="size-4" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="bg-popover text-popover-foreground z-50 min-w-40 rounded-md border p-1 shadow-md"
      sideOffset={4}
      align="end"
    >
      {#if room}
        <DropdownMenu.Item class={itemClass} onSelect={() => onNick?.()}>
          <Pencil class="size-4" />
          {$LL.changeNickname()}
        </DropdownMenu.Item>
        <DropdownMenu.Item class={itemClass} onSelect={() => onInvite?.()}>
          <UserPlus class="size-4" />
          {$LL.inviteToRoom()}
        </DropdownMenu.Item>
        {#if canEditSubject}
          <DropdownMenu.Item class={itemClass} onSelect={() => onSubject?.()}>
            <Quote class="size-4" />
            {$LL.editSubject()}
          </DropdownMenu.Item>
        {/if}
        {#if canConfigure}
          <DropdownMenu.Item class={itemClass} onSelect={() => onConfig?.()}>
            <Settings class="size-4" />
            {$LL.roomConfig()}
          </DropdownMenu.Item>
        {/if}
      {:else}
        <DropdownMenu.Item class={itemClass} onSelect={onToggleBookmark}>
          {#if peerBookmarked}
            <BookmarkX class="size-4" />
            {$LL.removeBookmark()}
          {:else}
            <BookmarkIcon class="size-4" />
            {$LL.bookmarkContact()}
          {/if}
        </DropdownMenu.Item>
        <DropdownMenu.Item class={itemClass} onSelect={() => onBuzz?.()}>
          <Zap class="size-4" />
          {$LL.buzz()}
        </DropdownMenu.Item>
        <DropdownMenu.Item class={itemClass} onSelect={() => onBlock?.()}>
          <Ban class="size-4" />
          {peerBlocked ? $LL.unblockUser() : $LL.blockUser()}
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
      <MenuSubs {conversation} {onSetNotify} {onSetEphemeral} />
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
