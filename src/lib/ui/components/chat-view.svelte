<script lang="ts">
  import { ArrowLeft, Columns2, LogOut, Users, X } from '@lucide/svelte'

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

  // peer: which conversation this pane shows. split: true when rendered in a
  // secondary pane (has its own conversation picker + close button).
  let { peer, split = false }: { peer: string | null; split?: boolean } = $props()

  const account = $derived(accounts.active)
  const store = $derived(account ? app.chatsFor(account.jid) : undefined)
  const conversation = $derived(peer && store ? store.open(peer) : undefined)
  const contact = $derived(account?.roster.find((c) => c.jid === peer))
  const isRoom = $derived(conversation?.kind === 'muc')

  // conversations the split pane can show (everything but the primary peer)
  const splitChoices = $derived(
    store
      ? [...store.conversations.values()]
          .filter((c) => c.messages.length > 0 && c.peerJid !== app.activePeer)
          .map((c) => c.peerJid)
      : []
  )

  let showOccupants = $state(false)

  function leaveRoom() {
    if (!account || !conversation?.ourNick) return
    account.leaveRoom(conversation.peerJid, conversation.ourNick)
    if (split) app.splitPeer = null
    else app.activePeer = null
  }
</script>

{#snippet paneContent()}
  {#if conversation}
    <div class="flex h-full min-w-0">
      <div class="flex h-full min-w-0 flex-1 flex-col">
        <header class="flex items-center gap-2 p-3">
          {#if !split}
            <Button
              variant="ghost"
              size="icon"
              class="md:hidden"
              onclick={() => (app.activePeer = null)}
              aria-label={$LL.back()}
            >
              <ArrowLeft class="size-5" />
            </Button>
          {/if}
          <Avatar>
            <AvatarFallback>
              {(isRoom ? '#' : '') + (contact?.name || conversation.peerJid).slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <h2 class="truncate font-medium">
              {isRoom ? conversation.peerJid.split('@')[0] : contact?.name || conversation.peerJid}
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
          <div class="flex shrink-0 items-center gap-0.5">
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
            {#if !split}
              <Button
                variant="ghost"
                size="icon"
                class="hidden md:inline-flex"
                onclick={() => (app.splitPeer = app.splitPeer === null ? '' : null)}
                aria-label={$LL.splitView()}
                aria-pressed={app.splitPeer !== null}
              >
                <Columns2 class="size-4" />
              </Button>
            {/if}
          </div>
        </header>
        <Separator />
        <MessageList
          {conversation}
          selfJid={account?.jid ?? ''}
          onQuoteClick={(id) => {
            document.getElementById(`m-${id}`)?.scrollIntoView({ block: 'center' })
          }}
          onReply={(message) => {
            app.composer = { replyTo: message }
            app.composerFocus?.()
          }}
          onEdit={(message) => {
            if (message.outgoing) {
              app.composer = { editing: message }
              app.composerFocus?.()
            }
          }}
          onReact={(message, emoji) => {
            if (!account) return
            const self = isRoom ? (conversation.ourNick ?? '') : account.jid
            const senders = message.reactions[emoji] ?? []
            const emojis = senders.includes(self)
              ? Object.keys(message.reactions).filter(
                  (e) => e !== emoji && (message.reactions[e] ?? []).includes(self)
                )
              : [
                  ...Object.keys(message.reactions).filter((e) =>
                    (message.reactions[e] ?? []).includes(self)
                  ),
                  emoji
                ]
            // MUC reactions/replies reference the room stanza-id, DMs the
            // wire id; message.id holds the stanza-id when the server sent one
            const ref = isRoom ? message.id : (message.wireId ?? message.id)
            const type = isRoom ? 'groupchat' : 'chat'
            account.connection.sendReaction(conversation.peerJid, ref, emojis, type)
            app.chatsFor(account.jid).applyReaction(conversation.peerJid, self, ref, emojis)
          }}
        />
        <Composer
          peerJid={conversation.peerJid}
          kind={conversation.kind}
          peerName={isRoom ? conversation.peerJid.split('@')[0] : (contact?.name ?? undefined)}
        />
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
{/snippet}

{#if split}
  <div class="flex h-full min-w-0 flex-col">
    <div class="flex items-center gap-2 border-b p-2">
      <select
        class="bg-background min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
        value={peer ?? ''}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value
          app.splitPeer = v || null
        }}
        aria-label={$LL.openInSplit()}
      >
        <option value="">{$LL.pickConversation()}</option>
        {#each splitChoices as jid (jid)}
          <option value={jid}>{jid}</option>
        {/each}
      </select>
      <Button
        variant="ghost"
        size="icon"
        onclick={() => (app.splitPeer = null)}
        aria-label={$LL.closePane()}
      >
        <X class="size-4" />
      </Button>
    </div>
    <div class="min-h-0 flex-1">
      {@render paneContent()}
    </div>
  </div>
{:else}
  {@render paneContent()}
{/if}
