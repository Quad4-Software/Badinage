<script lang="ts">
  import { PanelLeftOpen, Settings } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { cn } from '$lib/utils/cn'
  import { Button } from '$lib/ui/primitives/button'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'

  import PeerAvatar from '../peer-avatar.svelte'
  import PresenceDot from '../../presence/presence-dot.svelte'
  import ThemeToggle from '../../shell/theme-toggle.svelte'

  const account = $derived(accounts.active)
  const store = $derived(account ? app.chatsFor(account.jid) : undefined)
  const roster = $derived(account?.roster ?? [])

  // same filters as chat-sidebar: active dms, joined or active rooms,
  // then every roster contact that has no dm conversation listed
  const dms = $derived(
    store
      ? [...store.conversations.values()].filter(
          (c) => c.kind === 'dm' && (c.messages.length > 0 || c.peerJid === app.activePeer)
        )
      : []
  )
  const rooms = $derived(
    store
      ? [...store.conversations.values()].filter(
          (c) => c.kind === 'muc' && (c.joined || c.messages.length > 0)
        )
      : []
  )
  const dmPeers = $derived(new Set(dms.map((c) => c.peerJid)))
  const contacts = $derived(roster.filter((c) => !dmPeers.has(c.jid)))

  // roster names keyed by jid so list rendering is not O(conv x roster)
  const rosterNames = $derived(new Map(roster.map((c) => [c.jid, c.name])))

  function displayName(peerJid: string): string {
    return rosterNames.get(peerJid) || peerJid
  }

  function roomName(peerJid: string): string {
    return peerJid.split('@')[0] ?? ''
  }

  function open(jid: string) {
    app.selectPeer(jid)
    // no composer focus on touch devices: it would pop the keyboard
    if (window.matchMedia('(pointer: fine)').matches) app.focusComposer(jid)
  }
</script>

<div class="flex h-full w-14 flex-col items-center gap-1 border-r py-2">
  <Button
    variant="ghost"
    size="icon"
    onclick={() => app.dispatch('nav.toggleSidebar')}
    aria-label={$LL.expandSidebar()}
  >
    <PanelLeftOpen class="size-4" />
  </Button>

  <ScrollArea class="w-full flex-1">
    <nav class="flex flex-col items-center gap-1 px-2" aria-label={$LL.conversations()}>
      {#each dms as conversation (conversation.peerJid)}
        {@const name = displayName(conversation.peerJid)}
        <button
          class="hover:bg-accent rounded-full p-0.5"
          aria-label={name}
          title={conversation.peerJid}
          onclick={() => open(conversation.peerJid)}
        >
          <span class="relative block">
            <PeerAvatar
              jid={conversation.peerJid}
              fallback={name.slice(0, 2)}
              force
              class={cn('size-9', app.activePeer === conversation.peerJid && 'ring-primary ring-2')}
            />
            {#if conversation.unread > 0}
              <span
                class="bg-primary text-primary-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[0.6rem]"
              >
                {conversation.unread > 9 ? '9+' : conversation.unread}
              </span>
            {/if}
          </span>
        </button>
      {/each}
      {#each rooms as room (room.peerJid)}
        {@const name = roomName(room.peerJid)}
        <button
          class="hover:bg-accent rounded-full p-0.5"
          aria-label={name}
          title={room.peerJid}
          onclick={() => open(room.peerJid)}
        >
          <span class="relative block">
            <PeerAvatar
              jid={room.peerJid}
              fallback={`#${name.slice(0, 1)}`}
              force
              class={cn('size-9', app.activePeer === room.peerJid && 'ring-primary ring-2')}
            />
            {#if room.unread > 0}
              <span
                class="bg-primary text-primary-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[0.6rem]"
              >
                {room.unread > 9 ? '9+' : room.unread}
              </span>
            {/if}
          </span>
        </button>
      {/each}
      {#each contacts as contact (contact.jid)}
        {@const name = contact.name || contact.jid}
        <button
          class="hover:bg-accent rounded-full p-0.5"
          aria-label={name}
          title={contact.jid}
          onclick={() => open(contact.jid)}
        >
          <span class="relative block">
            <PeerAvatar
              jid={contact.jid}
              fallback={name.slice(0, 2)}
              class={cn('size-9', app.activePeer === contact.jid && 'ring-primary ring-2')}
            />
            <PresenceDot
              presence={contact.presence}
              class="ring-background absolute -right-0.5 -bottom-0.5 ring-2"
            />
          </span>
        </button>
      {/each}
    </nav>
  </ScrollArea>

  <PresenceDot
    presence={account?.status === 'connected' ? account.presence : 'offline'}
    class="size-3"
  />
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
