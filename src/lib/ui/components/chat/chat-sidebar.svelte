<script lang="ts">
  import { Hash, Search, UserPlus } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import type { Bookmark } from '$lib/core/xmpp/connection'
  import { app } from '$lib/state/app.svelte'
  import { explore } from '$lib/state/explore'
  import { parseJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { Separator } from '$lib/ui/primitives/separator'
  import { Skeleton } from '$lib/ui/primitives/skeleton'

  import BookmarkRow from './sidebar/bookmark-row.svelte'
  import ContactRow from './sidebar/contact-row.svelte'
  import ConversationRow from './sidebar/conversation-row.svelte'
  import RoomInvites from './sidebar/room-invites.svelte'
  import SidebarHeader from './sidebar/sidebar-header.svelte'
  import SidebarSection from './sidebar/sidebar-section.svelte'
  import SubscriptionRequests from './sidebar/subscription-requests.svelte'

  const account = $derived(accounts.active)
  const store = $derived(account ? app.chatsFor(account.jid) : undefined)
  const roster = $derived(account?.roster ?? [])
  const subscriptions = $derived(account?.subscriptions ?? [])
  const roomInvites = $derived(account?.roomInvites ?? [])

  let query = $state('')
  const q = $derived(query.trim().toLowerCase())
  const matches = $derived(
    (label: string, jid: string) =>
      !q || label.toLowerCase().includes(q) || jid.toLowerCase().includes(q)
  )

  const conversations = $derived(
    store
      ? [...store.conversations.values()].filter(
          (c) =>
            c.kind === 'dm' &&
            (c.messages.length > 0 || c.peerJid === app.activePeer) &&
            matches(displayName(c.peerJid), c.peerJid)
        )
      : []
  )
  const rooms = $derived(
    store
      ? [...store.conversations.values()].filter(
          (c) =>
            c.kind === 'muc' && (c.joined || c.messages.length > 0) && matches(c.peerJid, c.peerJid)
        )
      : []
  )
  const contacts = $derived(roster.filter((c) => matches(c.name || c.jid, c.jid)))
  const bookmarks = $derived(
    account ? [...account.bookmarks.values()].filter((b) => matches(b.name || b.jid, b.jid)) : []
  )

  let showConversations = $state(true)
  let showRooms = $state(true)
  let showBookmarks = $state(true)
  let showContacts = $state(true)

  // roster names keyed by jid so list rendering is not O(conv x roster)
  const rosterNames = $derived(new Map(roster.map((c) => [c.jid, c.name])))

  function displayName(peerJid: string): string {
    return rosterNames.get(peerJid) || peerJid
  }

  function open(peerJid: string) {
    store?.open(peerJid)
    app.selectPeer(peerJid)
    // no composer focus on touch devices: it would pop the keyboard
    if (window.matchMedia('(pointer: fine)').matches) app.focusComposer(peerJid)
  }

  // a bookmarked room is joined first when it is not already open.
  // contacts go straight to the dm view
  function openBookmark(bookmark: Bookmark) {
    if (!account) return
    if (bookmark.kind === 'conference') {
      const conversation = store?.open(bookmark.jid, 'muc')
      if (!conversation?.joined) {
        account.joinRoom(
          bookmark.jid,
          bookmark.nick || parseJid(account.jid).local || 'me',
          bookmark.password
        )
      }
    }
    open(bookmark.jid)
  }
</script>

<div class="flex h-full min-w-0 flex-col">
  <SidebarHeader bind:query />

  <Separator />

  <ScrollArea class="flex-1">
    <nav class="flex flex-col gap-0.5 p-2" aria-label={$LL.conversations()}>
      <SubscriptionRequests requests={subscriptions} />
      <RoomInvites invites={roomInvites} />

      <SidebarSection title={$LL.conversations()} bind:expanded={showConversations} class="mt-2">
        {#each conversations as conversation (conversation.peerJid)}
          <ConversationRow
            {conversation}
            name={displayName(conversation.peerJid)}
            selected={app.activePeer === conversation.peerJid}
            onSelect={() => open(conversation.peerJid)}
          />
        {/each}
      </SidebarSection>

      <SidebarSection title={$LL.rooms()} bind:expanded={showRooms}>
        {#snippet action()}
          <Button
            variant="ghost"
            size="icon"
            class="size-6 shrink-0"
            onclick={() => (explore.open = true)}
            aria-label={$LL.exploreRooms()}
          >
            <Search class="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="size-6 shrink-0"
            onclick={() => (app.joinRoomOpen = true)}
            aria-label={$LL.joinRoom()}
          >
            <Hash class="size-3.5" />
          </Button>
        {/snippet}
        {#each rooms as room (room.peerJid)}
          <ConversationRow
            conversation={room}
            name={room.peerJid.split('@')[0] ?? ''}
            selected={app.activePeer === room.peerJid}
            onSelect={() => open(room.peerJid)}
          />
        {/each}
      </SidebarSection>

      {#if bookmarks.length > 0}
        <SidebarSection title={$LL.bookmarks()} bind:expanded={showBookmarks}>
          {#each bookmarks as bookmark (bookmark.jid)}
            <BookmarkRow {bookmark} onSelect={() => openBookmark(bookmark)} />
          {/each}
        </SidebarSection>
      {/if}

      <SidebarSection title={$LL.contacts()} bind:expanded={showContacts}>
        {#snippet action()}
          <Button
            variant="ghost"
            size="icon"
            class="size-6 shrink-0"
            onclick={() => (app.addContactOpen = true)}
            aria-label={$LL.addContact()}
          >
            <UserPlus class="size-3.5" />
          </Button>
        {/snippet}
        {#each contacts as contact (contact.jid)}
          <ContactRow
            {contact}
            blocked={account?.isBlocked(contact.jid) ?? false}
            onSelect={() => open(contact.jid)}
          />
        {:else}
          {#if q}
            <!-- a filtered-empty list is a miss, not an empty roster.
                 the nav-level line below reports it -->
          {:else if account?.status === 'connecting'}
            <div class="flex flex-col gap-2 p-2" role="status" aria-label={$LL.loadingContacts()}>
              {#each Array.from({ length: 6 }) as _, i (i)}
                <div class="flex items-center gap-3">
                  <Skeleton class="size-8 rounded-full" />
                  <Skeleton class="h-4 flex-1" />
                </div>
              {/each}
              <p class="text-muted-foreground mt-2 text-xs">{$LL.connectingStatus()}</p>
            </div>
          {:else}
            <p class="text-muted-foreground px-2 py-4 text-sm">{$LL.emptyRoster()}</p>
          {/if}
        {/each}
      </SidebarSection>

      {#if q && conversations.length === 0 && rooms.length === 0 && bookmarks.length === 0 && contacts.length === 0}
        <p class="text-muted-foreground px-2 py-4 text-sm">{$LL.noMatches({ query })}</p>
      {/if}
    </nav>
  </ScrollArea>
</div>
