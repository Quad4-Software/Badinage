<script lang="ts">
  import { ArrowLeft, LogOut, Users } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { Avatar, AvatarFallback } from '$lib/ui/primitives/avatar'
  import { Button } from '$lib/ui/primitives/button'
  import { Separator } from '$lib/ui/primitives/separator'

  import Composer from './composer.svelte'
  import MessageList from './message-list.svelte'
  import OccupantList from './occupant-list.svelte'
  import PresenceDot from './presence-dot.svelte'

  const account = $derived(accounts.active)
  const store = $derived(account ? app.chatsFor(account.jid) : undefined)
  const conversation = $derived(app.activePeer && store ? store.open(app.activePeer) : undefined)
  const contact = $derived(account?.roster.find((c) => c.jid === app.activePeer))
  const isRoom = $derived(conversation?.kind === 'muc')

  let showOccupants = $state(false)

  function leaveRoom() {
    if (!account || !conversation?.ourNick) return
    account.leaveRoom(conversation.peerJid, conversation.ourNick)
    app.activePeer = null
  }
</script>

{#if conversation}
  <div class="flex h-full">
    <div class="flex h-full min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-3 p-3">
        <Button
          variant="ghost"
          size="icon"
          class="md:hidden"
          onclick={() => (app.activePeer = null)}
          aria-label={$LL.back()}
        >
          <ArrowLeft class="size-5" />
        </Button>
        <Avatar>
          <AvatarFallback>
            {(isRoom ? '#' : '') + (contact?.name || conversation.peerJid).slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div class="min-w-0 flex-1">
          <h2 class="truncate font-medium">
            {isRoom ? conversation.peerJid : contact?.name || conversation.peerJid}
          </h2>
          <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
            {#if isRoom}
              <span class="truncate">{conversation.subject ?? ''}</span>
            {:else if conversation.peerState === 'composing'}
              <span class="text-primary">{$LL.typing()}</span>
            {:else if contact}
              <PresenceDot presence={contact.presence} />
              {contact.presenceStatus || contact.presence}
            {:else}
              {conversation.peerJid}
            {/if}
          </p>
        </div>
        {#if isRoom}
          <Button
            variant="ghost"
            size="icon"
            onclick={() => (showOccupants = !showOccupants)}
            aria-label={$LL.occupants({ count: conversation.occupants.size })}
            aria-pressed={showOccupants}
          >
            <Users class="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onclick={leaveRoom} aria-label={$LL.leaveRoom()}>
            <LogOut class="size-4" />
          </Button>
        {/if}
      </header>
      <Separator />
      <MessageList {conversation} />
      <Composer peerJid={conversation.peerJid} kind={conversation.kind} />
    </div>
    {#if isRoom && showOccupants}
      <aside class="hidden w-56 shrink-0 border-l md:block">
        <OccupantList {conversation} />
      </aside>
    {/if}
  </div>
{:else}
  <div class="text-muted-foreground flex h-full items-center justify-center p-8 text-center">
    {$LL.noConversation()}
  </div>
{/if}
