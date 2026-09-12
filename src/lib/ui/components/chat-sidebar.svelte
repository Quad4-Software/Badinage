<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { ChevronDown, ChevronRight, Hash, Search, Settings, UserPlus } from '@lucide/svelte'

  import { Avatar, AvatarFallback } from '$lib/ui/primitives/avatar'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { Separator } from '$lib/ui/primitives/separator'
  import { Skeleton } from '$lib/ui/primitives/skeleton'

  import AccountSwitcher from './account-switcher.svelte'
  import PresenceDot from './presence-dot.svelte'
  import ThemeToggle from './theme-toggle.svelte'

  const account = $derived(accounts.active)
  const store = $derived(account ? app.chatsFor(account.jid) : undefined)
  const roster = $derived(account?.roster ?? [])
  const subscriptions = $derived(account?.subscriptions ?? [])

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

  let showConversations = $state(true)
  let showRooms = $state(true)
  let showContacts = $state(true)

  function displayName(peerJid: string): string {
    return roster.find((c) => c.jid === peerJid)?.name || peerJid
  }

  function initials(name: string): string {
    return name.slice(0, 2)
  }

  function open(peerJid: string) {
    store?.open(peerJid)
    app.selectPeer(peerJid)
    app.sidebarOpen = false
  }
</script>

{#snippet unreadBadge(count: number)}
  <span
    class="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] leading-none font-medium"
    aria-label={$LL.unread({ count })}
  >
    {count > 99 ? '99+' : count}
  </span>
{/snippet}

<div class="flex h-full min-w-0 flex-col">
  <header class="flex items-center justify-between gap-1 p-3">
    <h1 class="truncate text-lg font-semibold">{$LL.appName()}</h1>
    <div class="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        onclick={() => (app.settingsOpen = true)}
        aria-label={$LL.openSettings()}
      >
        <Settings class="size-4" />
      </Button>
      <ThemeToggle />
    </div>
  </header>

  <div class="px-3 pb-3">
    <AccountSwitcher />
  </div>

  <div class="px-3 pb-2">
    <div class="relative">
      <Search
        class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
      />
      <Input bind:value={query} placeholder={$LL.search()} aria-label={$LL.search()} class="pl-8" />
    </div>
  </div>

  <Separator />

  <ScrollArea class="flex-1">
    <nav class="flex flex-col gap-0.5 p-2" aria-label={$LL.conversations()}>
      {#if subscriptions.length > 0}
        <h2 class="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
          {$LL.subscriptionRequests()}
        </h2>
        {#each subscriptions as request (request.from)}
          <div class="bg-muted/50 flex min-w-0 flex-col gap-2 rounded-md px-3 py-2">
            <p class="text-sm break-all">
              {$LL.wantsToSubscribe({ from: request.from })}
            </p>
            {#if request.status}
              <p class="text-muted-foreground text-xs break-words italic">{request.status}</p>
            {/if}
            <div class="flex gap-2">
              <Button size="sm" onclick={() => account?.acceptSubscription(request.from)}>
                {$LL.accept()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onclick={() => account?.denySubscription(request.from)}
              >
                {$LL.deny()}
              </Button>
            </div>
          </div>
        {/each}
      {/if}

      <div class="mt-2 flex items-center justify-between px-2 pb-1">
        <button
          class="text-muted-foreground flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
          onclick={() => (showConversations = !showConversations)}
          aria-expanded={showConversations}
        >
          {#if showConversations}<ChevronDown class="size-3.5" />{:else}<ChevronRight
              class="size-3.5"
            />{/if}
          {$LL.conversations()}
        </button>
        <Button
          variant="ghost"
          size="icon"
          class="size-6 shrink-0"
          onclick={() => (app.addContactOpen = true)}
          aria-label={$LL.addContact()}
        >
          <UserPlus class="size-3.5" />
        </Button>
      </div>
      {#if showConversations}
        {#each conversations as conversation (conversation.peerJid)}
          {@const name = displayName(conversation.peerJid)}
          <button
            class="hover:bg-accent flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left"
            class:bg-accent={app.activePeer === conversation.peerJid}
            onclick={() => open(conversation.peerJid)}
          >
            <Avatar class="shrink-0">
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{name}</span>
              <span class="text-muted-foreground block truncate text-xs">
                {#if conversation.peerState === 'composing'}
                  <span class="text-primary">{$LL.typing()}</span>
                {:else}
                  {conversation.messages.at(-1)?.body ?? ''}
                {/if}
              </span>
            </span>
            {#if conversation.unread > 0}
              {@render unreadBadge(conversation.unread)}
            {/if}
          </button>
        {/each}
      {/if}

      <div class="mt-4 flex items-center justify-between px-2 pb-1">
        <button
          class="text-muted-foreground flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
          onclick={() => (showRooms = !showRooms)}
          aria-expanded={showRooms}
        >
          {#if showRooms}<ChevronDown class="size-3.5" />{:else}<ChevronRight
              class="size-3.5"
            />{/if}
          {$LL.rooms()}
        </button>
        <Button
          variant="ghost"
          size="icon"
          class="size-6 shrink-0"
          onclick={() => (app.joinRoomOpen = true)}
          aria-label={$LL.joinRoom()}
        >
          <Hash class="size-3.5" />
        </Button>
      </div>
      {#if showRooms}
        {#each rooms as room (room.peerJid)}
          <button
            class="hover:bg-accent flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left"
            class:bg-accent={app.activePeer === room.peerJid}
            onclick={() => open(room.peerJid)}
          >
            <Avatar class="shrink-0">
              <AvatarFallback>#</AvatarFallback>
            </Avatar>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">
                {room.peerJid.split('@')[0]}
              </span>
              <span class="text-muted-foreground block truncate text-xs">
                {room.messages.at(-1)?.body ?? room.subject ?? ''}
              </span>
            </span>
            {#if room.unread > 0}
              {@render unreadBadge(room.unread)}
            {/if}
          </button>
        {/each}
      {/if}

      <div class="mt-4 flex items-center justify-between px-2 pb-1">
        <button
          class="text-muted-foreground flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
          onclick={() => (showContacts = !showContacts)}
          aria-expanded={showContacts}
        >
          {#if showContacts}<ChevronDown class="size-3.5" />{:else}<ChevronRight
              class="size-3.5"
            />{/if}
          {$LL.contacts()}
        </button>
      </div>
      {#if showContacts}
        {#each contacts as contact (contact.jid)}
          <button
            class="hover:bg-accent flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left"
            onclick={() => open(contact.jid)}
          >
            <span class="relative shrink-0">
              <Avatar>
                <AvatarFallback>{initials(contact.name || contact.jid)}</AvatarFallback>
              </Avatar>
              <PresenceDot
                presence={contact.presence}
                class="ring-background absolute -right-0.5 -bottom-0.5 ring-2"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm">{contact.name || contact.jid}</span>
              {#if contact.name}
                <span class="text-muted-foreground block truncate text-xs">{contact.jid}</span>
              {/if}
            </span>
          </button>
        {:else}
          {#if account?.status === 'connecting'}
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
      {/if}
    </nav>
  </ScrollArea>
</div>
