<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import {
    ArrowLeft,
    Ban,
    Columns2,
    EllipsisVertical,
    Lock,
    LogOut,
    Pencil,
    Quote,
    Settings,
    UserPlus,
    Users,
    X
  } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { cancelUpload, sendFileMessage } from '$lib/state/upload'
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/ui/primitives/avatar'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'
  import { Separator } from '$lib/ui/primitives/separator'
  import { toast } from '$lib/ui/primitives/sonner'
  import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/ui/primitives/tooltip'
  import { presenceLabel } from '$lib/ui/presence'

  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import ChangeNickDialog from '../dialogs/change-nick-dialog.svelte'
  import InviteUserDialog from '../dialogs/invite-user-dialog.svelte'
  import RoomConfigDialog from '../dialogs/room-config-dialog.svelte'
  import SubjectDialog from '../dialogs/subject-dialog.svelte'
  import Composer from './composer.svelte'
  import MessageList from './message-list.svelte'
  import OccupantList from './occupant-list.svelte'
  import RoomStatusBanner from './room-status-banner.svelte'
  import PresenceDot from '../presence/presence-dot.svelte'
  import TypingIndicator from './typing-indicator.svelte'

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
  let confirmBlock = $state(false)
  let dragOver = $state(false)
  // room dialogs
  let nickOpen = $state(false)
  let subjectOpen = $state(false)
  let inviteOpen = $state(false)
  let configOpen = $state(false)
  // XEP-0425 retraction confirm: the target message is captured because
  // the row can unmount before the dialog resolves
  let moderateTarget = $state<ChatMessage | null>(null)
  let moderateReason = $state('')

  // our own occupant record carries the role and affiliation that gate
  // every moderation and configuration control
  const selfOccupant = $derived(
    conversation ? [...conversation.occupants.values()].find((o) => o.self) : undefined
  )
  // XEP-0045: subject change is a moderator privilege by default
  const canEditSubject = $derived(selfOccupant?.role === 'moderator')
  const canConfigure = $derived(selfOccupant?.affiliation === 'owner')
  const canModerate = $derived(isRoom && selfOccupant?.role === 'moderator')

  // the outgoing message awaiting a retract confirm
  let retractTarget = $state<ChatMessage | null>(null)

  // reaction sender keys are bare jids in dms and nicks or XEP-0421
  // occupant ids in mucs; resolve all three to display names so the
  // tooltip stays readable
  function senderLabel(sender: string): string {
    if (!account || !conversation) return sender
    if (isRoom) {
      if (sender === conversation.ourNick || sender === conversation.ourOccupantId) {
        return $LL.you()
      }
      for (const occupant of conversation.occupants.values()) {
        if (occupant.occupantId === sender || occupant.nick === sender) return occupant.nick
      }
      return sender
    }
    if (sender === account.jid) return $LL.you()
    return account.roster.find((c) => c.jid === sender)?.name || sender
  }

  function retractMessage() {
    const target = retractTarget
    if (!target || !account || !conversation) return
    // dm retractions reference the stanza id attribute; muc retractions
    // the room stanza-id, which lands in message.id after the echo merge
    const ref = isRoom ? target.id : (target.wireId ?? target.id)
    account.connection.sendRetraction(conversation.peerJid, ref, isRoom ? 'groupchat' : 'chat')
    app.chatsFor(account.jid).retract(conversation.peerJid, ref)
  }

  function onDragOver(event: DragEvent) {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
      dragOver = true
    }
  }

  // dragleave fires when entering a child too; only clear the overlay when
  // the pointer actually left the column
  function onDragLeave(event: DragEvent) {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget instanceof Node) {
      if (event.currentTarget.contains(next)) return
    }
    dragOver = false
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    dragOver = false
    if (!account || !conversation) return
    const chatType = conversation.kind === 'muc' ? 'groupchat' : 'chat'
    for (const file of event.dataTransfer?.files ?? []) {
      sendFileMessage(
        account,
        conversation.peerJid,
        chatType,
        file,
        file.name,
        file.type || 'application/octet-stream',
        () => toast.error($LL.uploadFailed())
      )
    }
  }

  const peerBlocked = $derived(peer ? (account?.isBlocked(peer) ?? false) : false)
  const typers = $derived(conversation ? [...conversation.typers] : [])

  function leaveRoom() {
    if (!account || !conversation?.ourNick) return
    account.leaveRoom(conversation.peerJid, conversation.ourNick)
    if (split) app.splitPeer = null
    else app.activePeer = null
  }

  // polite announcements for live incoming traffic; onLive already filters
  // out mam pages, delayed deliveries and our own carbons, and the split
  // pane skips mounting so messages never announce twice
  let liveSeq = $state(0)
  let liveText = $state('')
  $effect(() =>
    app.onLiveMessage((event) => {
      liveText = $LL.newMessageFrom({ name: event.sender })
      liveSeq += 1
    })
  )

  function changeNick(newNick: string) {
    if (!account || !conversation?.ourNick) return
    account.connection.changeRoomNick(
      conversation.peerJid,
      conversation.ourNick,
      newNick,
      conversation.password
    )
  }

  function sendInvite(jid: string, reason: string) {
    if (!account || !conversation) return
    // the stored room password rides along on the direct invite so a
    // password-protected room stays joinable from the invite alone
    account.connection.inviteToRoom(conversation.peerJid, jid, {
      reason: reason || undefined,
      password: conversation.password
    })
    toast.success($LL.inviteSent())
  }

  function doModerate() {
    if (!moderateTarget || !conversation) return
    // moderation addresses the room stanza-id, which message.id holds
    account?.connection.moderateMessage(
      conversation.peerJid,
      moderateTarget.id,
      moderateReason || undefined
    )
    moderateReason = ''
  }
</script>

{#if !split}
  <div class="sr-only" role="status">
    {#key liveSeq}{liveText}{/key}
  </div>
{/if}

{#snippet paneContent()}
  {#if conversation}
    <div class="flex h-full min-w-0">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="relative flex h-full min-w-0 flex-1 flex-col"
        ondragover={onDragOver}
        ondragleave={onDragLeave}
        ondrop={onDrop}
      >
        {#if dragOver}
          <div
            class="border-primary bg-primary/5 pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed text-sm font-medium"
          >
            {$LL.dropToSend()}
          </div>
        {/if}
        <div class="flex items-center gap-2 p-3">
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
            {#if isRoom && conversation.avatar}
              <AvatarImage src={conversation.avatar} alt="" />
            {/if}
            <AvatarFallback>
              {(isRoom ? '#' : '') + (contact?.name || conversation.peerJid).slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <h1 class="flex items-center gap-1.5 truncate font-medium">
              <span class="truncate">
                {isRoom
                  ? conversation.peerJid.split('@')[0]
                  : contact?.name || conversation.peerJid}
              </span>
              {#if !isRoom && conversation.encrypted}
                <Tooltip>
                  <TooltipTrigger>
                    {#snippet child({ props })}
                      <span {...props} class="inline-flex">
                        <Lock class="text-success size-3.5 shrink-0" />
                      </span>
                    {/snippet}
                  </TooltipTrigger>
                  <TooltipContent>{$LL.encryptedChat()}</TooltipContent>
                </Tooltip>
              {/if}
            </h1>
            <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
              {#if isRoom}
                {#if typers.length > 0}
                  <TypingIndicator class="text-primary" />
                  <span class="text-primary truncate"
                    >{$LL.typingNames({ names: typers.join(', ') })}</span
                  >
                {:else}
                  <span class="truncate">{conversation.subject ?? ''}</span>
                {/if}
              {:else if conversation.peerState === 'composing'}
                <TypingIndicator class="text-primary" />
                <span class="text-primary">{$LL.typing()}</span>
              {:else if contact}
                <PresenceDot presence={contact.presence} />
                <span class="truncate">
                  {presenceLabel(contact.presence)}{contact.presenceStatus
                    ? ` · ${contact.presenceStatus}`
                    : ''}
                </span>
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
              {#if conversation.joined}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger class="shrink-0">
                    {#snippet child({ props })}
                      <Button {...props} variant="ghost" size="icon" aria-label={$LL.roomOptions()}>
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
                      <DropdownMenu.Item
                        class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
                        onSelect={() => (nickOpen = true)}
                      >
                        <Pencil class="size-4" />
                        {$LL.changeNickname()}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
                        onSelect={() => (inviteOpen = true)}
                      >
                        <UserPlus class="size-4" />
                        {$LL.inviteToRoom()}
                      </DropdownMenu.Item>
                      {#if canEditSubject}
                        <DropdownMenu.Item
                          class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
                          onSelect={() => (subjectOpen = true)}
                        >
                          <Quote class="size-4" />
                          {$LL.editSubject()}
                        </DropdownMenu.Item>
                      {/if}
                      {#if canConfigure}
                        <DropdownMenu.Item
                          class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
                          onSelect={() => (configOpen = true)}
                        >
                          <Settings class="size-4" />
                          {$LL.roomConfig()}
                        </DropdownMenu.Item>
                      {/if}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              {/if}
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
            {#if !isRoom}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class="shrink-0">
                  {#snippet child({ props })}
                    <Button {...props} variant="ghost" size="icon" aria-label={$LL.chatOptions()}>
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
                    <DropdownMenu.Item
                      class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
                      onSelect={() => {
                        if (peerBlocked) account?.unblock(conversation.peerJid)
                        else confirmBlock = true
                      }}
                    >
                      <Ban class="size-4" />
                      {peerBlocked ? $LL.unblockUser() : $LL.blockUser()}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            {/if}
          </div>
        </div>
        <Separator />
        {#if isRoom}
          <RoomStatusBanner {conversation} />
        {/if}
        <MessageList
          {conversation}
          selfJid={account?.jid ?? ''}
          onQuoteClick={(id) => {
            document.getElementById(`m-${id}`)?.scrollIntoView({ block: 'center' })
          }}
          onReply={(message) => {
            app.setComposer(conversation.peerJid, { replyTo: message })
            app.focusComposer(conversation.peerJid)
          }}
          onEdit={(message) => {
            if (message.outgoing) {
              app.setComposer(conversation.peerJid, { editing: message })
              app.focusComposer(conversation.peerJid)
            }
          }}
          onReact={(message, emoji) => {
            if (!account) return
            // occupant-id keys reactions when the room assigns one, so a
            // rename mid-session does not split our pills
            const self = isRoom
              ? (conversation.ourOccupantId ?? conversation.ourNick ?? '')
              : account.jid
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
          {senderLabel}
          onRetract={(message) => (retractTarget = message)}
          onCancelUpload={(message) => cancelUpload(message.id)}
          {canModerate}
          onModerate={(message) => {
            moderateReason = ''
            moderateTarget = message
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

<ConfirmDialog
  bind:open={confirmBlock}
  title={$LL.blockUserTitle()}
  description={$LL.blockUserDescription({ jid: conversation?.peerJid ?? '' })}
  confirmLabel={$LL.block()}
  destructive
  onConfirm={() => conversation && account?.block(conversation.peerJid)}
/>

{#if isRoom && conversation}
  <ChangeNickDialog
    bind:open={nickOpen}
    currentNick={conversation.ourNick ?? ''}
    onSubmit={changeNick}
  />
  <SubjectDialog
    bind:open={subjectOpen}
    subject={conversation.subject ?? ''}
    onSubmit={(subject) => account?.connection.setRoomSubject(conversation.peerJid, subject)}
  />
  <InviteUserDialog bind:open={inviteOpen} onSubmit={sendInvite} />
  <RoomConfigDialog bind:open={configOpen} room={conversation.peerJid} />

  <ConfirmDialog
    open={moderateTarget !== null}
    onOpenChange={(o) => {
      if (!o) moderateTarget = null
    }}
    title={$LL.removeMessageTitle()}
    confirmLabel={$LL.removeMessage()}
    destructive
    onConfirm={doModerate}
  >
    <span class="block">{$LL.removeMessageDescription()}</span>
    <Input
      bind:value={moderateReason}
      placeholder={$LL.reasonOptional()}
      aria-label={$LL.reasonOptional()}
      class="mt-2"
    />
  </ConfirmDialog>
{/if}

<ConfirmDialog
  open={retractTarget !== null}
  onOpenChange={(open) => {
    if (!open) retractTarget = null
  }}
  title={$LL.retractMessageTitle()}
  description={$LL.retractMessageDescription()}
  confirmLabel={$LL.retract()}
  destructive
  onConfirm={retractMessage}
/>
