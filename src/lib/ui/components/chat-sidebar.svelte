<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { bareJid } from '$lib/utils/jid'
  import { Avatar, AvatarFallback } from '$lib/ui/primitives/avatar'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { Separator } from '$lib/ui/primitives/separator'

  import AccountSwitcher from './account-switcher.svelte'
  import PresenceDot from './presence-dot.svelte'
  import ThemeToggle from './theme-toggle.svelte'

  const account = $derived(accounts.active)
  const store = $derived(account ? app.chatsFor(account.jid) : undefined)
  const conversations = $derived(
    store ? [...store.conversations.values()].filter((c) => c.messages.length > 0) : []
  )
  const roster = $derived(account?.roster ?? [])

  function initials(name: string): string {
    return name.slice(0, 2)
  }

  function open(peerJid: string) {
    store?.open(peerJid)
    app.activePeer = bareJid(peerJid)
    app.sidebarOpen = false
  }
</script>

<div class="flex h-full flex-col">
  <header class="flex items-center justify-between gap-2 p-3">
    <h1 class="text-lg font-semibold">{$LL.appName()}</h1>
    <ThemeToggle />
  </header>

  <div class="px-3 pb-3">
    <AccountSwitcher />
  </div>

  <Separator />

  <ScrollArea class="flex-1">
    <nav class="flex flex-col gap-0.5 p-2" aria-label={$LL.conversations()}>
      {#each conversations as conversation (conversation.peerJid)}
        {@const contact = roster.find((c) => c.jid === conversation.peerJid)}
        <button
          class="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-2 text-left"
          class:bg-accent={app.activePeer === conversation.peerJid}
          onclick={() => open(conversation.peerJid)}
        >
          <Avatar>
            <AvatarFallback>
              {initials(contact?.name || conversation.peerJid)}
            </AvatarFallback>
          </Avatar>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">
              {contact?.name || conversation.peerJid}
            </span>
            <span class="text-muted-foreground block truncate text-xs">
              {conversation.messages.at(-1)?.body ?? ''}
            </span>
          </span>
          {#if conversation.unread > 0}
            <span
              class="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs"
              aria-label={$LL.unread({ count: conversation.unread })}
            >
              {conversation.unread}
            </span>
          {/if}
        </button>
      {/each}

      <h2 class="text-muted-foreground mt-4 px-2 pb-1 text-xs font-medium tracking-wide uppercase">
        {$LL.contacts()}
      </h2>
      {#each roster as contact (contact.jid)}
        <button
          class="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-2 text-left"
          onclick={() => open(contact.jid)}
        >
          <span class="relative">
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
        <p class="text-muted-foreground px-2 py-4 text-sm">{$LL.emptyRoster()}</p>
      {/each}
    </nav>
  </ScrollArea>
</div>
