<script lang="ts">
  import { BellOff, Timer } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Conversation } from '$lib/state/chats.svelte'
  import type { MenuItem } from '$lib/state/app/menus.svelte'
  import { cn } from '$lib/utils/cn'
  import { mediaKind } from '$lib/utils/media'

  import { contextArea } from '../../context-menu/area'
  import PeerAvatar from '../peer-avatar.svelte'
  import TypingIndicator from '../typing-indicator.svelte'

  interface Props {
    conversation: Conversation
    // display name: roster name or jid for dms, room address local part for mucs
    name: string
    selected?: boolean
    onSelect: () => void
    // right click menu entries, resolved per row by the parent
    menuItems?: () => MenuItem[]
  }

  let { conversation, name, selected = false, onSelect, menuItems }: Props = $props()

  const isRoom = $derived(conversation.kind === 'muc')
  const initials = $derived(name.slice(0, 2))
  const typers = $derived([...conversation.typers])

  // sidebar preview line: attachment-only messages have their url as the
  // body, which reads poorly in a list - show a kind label instead
  function previewText(conversation: Conversation): string {
    const last = conversation.messages.at(-1)
    if (!last) return conversation.subject ?? ''
    const attachment = last.attachments?.[0]
    if (!attachment) return last.body
    switch (mediaKind(attachment.url, attachment.mediaType)) {
      case 'image':
        return $LL.imageAttachment()
      case 'video':
        return $LL.videoAttachment()
      case 'audio':
        return $LL.voiceMessage()
      default:
        return attachment.name ?? $LL.fileAttachment()
    }
  }
</script>

<button
  class="hover:bg-accent flex min-w-0 items-center gap-3 rounded-md px-2 py-[var(--density-row-pad)] text-left"
  class:bg-accent={selected}
  onclick={onSelect}
  {@attach contextArea({
    section: 'sidebar.conversation',
    payload: {
      peerJid: conversation.peerJid,
      kind: conversation.kind,
      name
    },
    items: () => menuItems?.() ?? []
  })}
>
  <PeerAvatar jid={conversation.peerJid} fallback={isRoom ? '#' : initials} force />
  <span class="min-w-0 flex-1">
    <span class="density-text-sm block truncate font-medium">{name}</span>
    <span
      class={cn(
        'density-text-xs block truncate',
        selected ? 'text-foreground/70' : 'text-muted-foreground'
      )}
    >
      {#if isRoom}
        {#if typers.length > 0}
          <span class="text-primary inline-flex items-center gap-1.5">
            <TypingIndicator />
            {$LL.typingNames({ names: typers.join(', ') })}
          </span>
        {:else}
          {previewText(conversation)}
        {/if}
      {:else if conversation.peerState === 'composing'}
        <span class="text-primary inline-flex items-center gap-1.5">
          <TypingIndicator />
          {$LL.typing()}
        </span>
      {:else}
        {previewText(conversation)}
      {/if}
    </span>
  </span>
  {#if conversation.ephemeralTimer}
    <Timer class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" role="img" />
  {/if}
  {#if conversation.notify === 'never'}
    <BellOff class="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" role="img" />
  {/if}
  <!-- muted conversations keep their counter but never badge it up -->
  {#if conversation.unread > 0 && conversation.notify !== 'never'}
    <span
      class="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] leading-none font-medium"
      aria-label={$LL.unread({ count: conversation.unread })}
    >
      {conversation.unread > 99 ? '99+' : conversation.unread}
    </span>
  {:else if conversation.unread > 0}
    <span
      class="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] leading-none font-medium"
      aria-label={$LL.unread({ count: conversation.unread })}
    >
      {conversation.unread > 99 ? '99+' : conversation.unread}
    </span>
  {/if}
</button>
