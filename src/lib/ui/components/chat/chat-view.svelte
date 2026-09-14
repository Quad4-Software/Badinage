<script lang="ts">
  import {
    ArrowLeft,
    Bookmark as BookmarkIcon,
    BookmarkX,
    Columns2,
    Lock,
    LogOut,
    Timer,
    Users,
    X
  } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { cancelUpload, sendFileMessage } from '$lib/state/upload'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'
  import { Separator } from '$lib/ui/primitives/separator'
  import { toast } from '$lib/ui/primitives/sonner'
  import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/ui/primitives/tooltip'
  import { presenceClass, presenceLabel } from '$lib/ui/presence'
  import { cn } from '$lib/utils/cn'
  import { Sheet } from '$lib/ui/primitives/sheet'

  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import CallButtons from '../call/call-buttons.svelte'
  import ChangeNickDialog from '../dialogs/change-nick-dialog.svelte'
  import InviteUserDialog from '../dialogs/invite-user-dialog.svelte'
  import RoomConfigDialog from '../dialogs/room-config-dialog.svelte'
  import SubjectDialog from '../dialogs/subject-dialog.svelte'
  import Composer from './composer.svelte'
  import PeerAvatar from './peer-avatar.svelte'
  import MessageList from './message-list.svelte'
  import MessageSheet from './message-item/sheet.svelte'
  import OccupantList from './occupant-list.svelte'
  import RoomStatusBanner from './room-status-banner.svelte'
  import TypingIndicator from './typing-indicator.svelte'
  import { createChatActions } from './chat-view/actions'
  import { ephemeralLabel } from './chat-view/ephemeral'
  import OptionsMenu from './chat-view/options-menu.svelte'
  import { contextArea } from '../context-menu/area'
  import { conversationMenu } from './sidebar/row-menu.svelte'

  // peer: which conversation this pane shows. split: true when rendered in a
  // secondary pane (has its own conversation picker + close button).
  let { peer, split = false }: { peer: string | null; split?: boolean } = $props()

  const account = $derived(accounts.active)
  const isIrc = $derived(account?.options.protocol === 'irc')
  const store = $derived(account ? app.chatsFor(account.jid) : undefined)
  const conversation = $derived(peer && store ? store.open(peer) : undefined)
  const contact = $derived(account?.roster.find((c) => c.jid === peer))
  const isRoom = $derived(conversation?.kind === 'muc')
  const rosterNames = $derived(new Map((account?.roster ?? []).map((c) => [c.jid, c.name])))

  // roster name or full jid on XMPP. On IRC the jid domain is
  // synthetic noise, so the bare nick reads better
  function displayName(jid: string): string {
    return rosterNames.get(jid) || (isIrc ? (jid.split('@')[0] ?? jid) : jid)
  }

  // conversations the split pane can show: joined rooms and dms with
  // traffic, everything but the primary peer. Rooms and dms are split
  // into optgroups so the picker reads like the sidebar
  const splitChoices = $derived(
    store
      ? [...store.conversations.values()]
          .filter((c) => (c.joined || c.messages.length > 0) && c.peerJid !== app.activePeer)
          .map((c) => ({
            jid: c.peerJid,
            room: c.kind === 'muc',
            name: c.kind === 'muc' ? (c.peerJid.split('@')[0] ?? c.peerJid) : displayName(c.peerJid)
          }))
      : []
  )
  const splitRooms = $derived(splitChoices.filter((c) => c.room))
  const splitDms = $derived(splitChoices.filter((c) => !c.room))
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
  // XEP-0045: subject change is a moderator privilege by default, but
  // the room may open it to all occupants via muc#roominfo_changesubject
  const canEditSubject = $derived(
    selfOccupant?.role === 'moderator' || conversation?.roomInfo?.changeSubject === true
  )
  // owner configuration is an XMPP form. IRC channel config lives in
  // ChanServ, so the button stays hidden on transports without it
  const canConfigure = $derived(
    selfOccupant?.affiliation === 'owner' && account?.caps.roomConfig === true
  )
  const canModerate = $derived(isRoom && selfOccupant?.role === 'moderator')

  // the outgoing message awaiting a retract confirm
  let retractTarget = $state<ChatMessage | null>(null)

  // virtualized list handle for quote jumps into unmounted rows
  let msgList = $state<MessageList | undefined>(undefined)

  // the long-press sheet: target outlives the close animation
  let sheetMessage = $state<ChatMessage | null>(null)
  let sheetOpen = $state(false)

  // occupant list is an aside on desktop and a bottom sheet on mobile
  let desktop = $state(true)
  $effect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => (desktop = mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  })

  // reaction sender keys are bare jids in dms and nicks or XEP-0421
  // occupant ids in mucs. Resolve all three to display names so the
  // tooltip stays readable
  const actions = createChatActions({
    account: () => account,
    conversation: () => conversation,
    isRoom: () => isRoom,
    contact: () => contact,
    peerBookmarked: () => peerBookmarked,
    split: () => split,
    moderateTarget: () => moderateTarget,
    moderateReason: () => moderateReason,
    setModerateReason: (v) => (moderateReason = v)
  })
  const {
    senderLabel,
    toggleBookmark,
    leaveRoom,
    changeNick,
    sendInvite,
    doModerate,
    setNotify,
    setEphemeral,
    buzz,
    sendReactionSet
  } = actions

  function retractMessage() {
    actions.retractMessage(retractTarget)
  }

  function onDragOver(event: DragEvent) {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
      dragOver = true
    }
  }

  // dragleave fires when entering a child too. Only clear the overlay when
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

  // toggling an emoji keeps every other reaction of ours. Muc reactions
  // reference the room stanza-id, dms the wire id
  function reactToMessage(message: ChatMessage, emoji: string) {
    if (!account || !conversation) return
    // occupant-id keys reactions when the room assigns one, so a
    // rename mid-session does not split our pills
    const self = isRoom ? (conversation.ourOccupantId ?? conversation.ourNick ?? '') : account.jid
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
    const ref = isRoom ? message.id : (message.wireId ?? message.id)
    sendReactionSet(conversation.peerJid, ref, emojis)
    app.chatsFor(account.jid).applyReaction(conversation.peerJid, self, ref, emojis)
  }

  const peerBlocked = $derived(peer ? (account?.isBlocked(peer) ?? false) : false)
  const peerBookmarked = $derived(peer ? (account?.isBookmarked(peer) ?? false) : false)
  const typers = $derived(conversation ? [...conversation.typers] : [])

  // polite announcements for live incoming traffic. OnLive already filters
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

  // XEP-0301: live text buffers still inside their ttl. Dm uses the ''
  // key, muc shows the first composing nick's buffer
  const rttPreview = $derived(
    conversation
      ? isRoom
        ? [...conversation.liveText.values()][0]?.text
        : conversation.liveText.get('')?.text
      : undefined
  )
</script>

{#if !split}
  <div class="sr-only" role="status">
    {#key liveSeq}{liveText}{/key}
  </div>
{/if}

{#snippet paneContent()}
  {#if conversation}
    {@const conv = conversation}
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
        <div
          class="flex items-center gap-2 p-3"
          {@attach contextArea({
            section: 'chat.header',
            payload: { jid: conv.peerJid, kind: conv.kind },
            items: () => conversationMenu(conv, account),
            skip: (t) => t.closest('button, a') !== null
          })}
        >
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
          <PeerAvatar
            jid={conv.peerJid}
            fallback={(isRoom ? '#' : '') + (contact?.name || conv.peerJid).slice(0, 2)}
            force
          />
          <div class="min-w-0 flex-1">
            <h1 class="flex items-center gap-1.5 truncate font-medium">
              <span class="truncate">
                {isRoom ? conv.peerJid.split('@')[0] : displayName(conv.peerJid)}
              </span>
              {#if conv.encrypted}
                <Tooltip>
                  <TooltipTrigger>
                    {#snippet child({ props })}
                      <span
                        {...props}
                        class="inline-flex"
                        role="img"
                        aria-label={$LL.encryptedChat()}
                      >
                        <Lock class="text-success size-3.5 shrink-0" />
                      </span>
                    {/snippet}
                  </TooltipTrigger>
                  <TooltipContent>{$LL.encryptedChat()}</TooltipContent>
                </Tooltip>
              {/if}
              {#if conv.ephemeralTimer}
                <Tooltip>
                  <TooltipTrigger>
                    {#snippet child({ props })}
                      <span
                        {...props}
                        class="inline-flex"
                        role="img"
                        aria-label={$LL.ephemeralActive({
                          time: ephemeralLabel(conv.ephemeralTimer)
                        })}
                      >
                        <Timer class="text-muted-foreground size-3.5 shrink-0" />
                      </span>
                    {/snippet}
                  </TooltipTrigger>
                  <TooltipContent>
                    {$LL.ephemeralActive({ time: ephemeralLabel(conv.ephemeralTimer) })}
                  </TooltipContent>
                </Tooltip>
              {/if}
            </h1>
            <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
              {#if isRoom}
                {#if typers.length > 0 || rttPreview}
                  <TypingIndicator class="text-primary" />
                  <span class="text-primary truncate"
                    >{$LL.typingNames({ names: typers.join(', ') })}{rttPreview
                      ? ` · ${rttPreview}`
                      : ''}</span
                  >
                {:else}
                  <span class="truncate">{conv.subject ?? ''}</span>
                {/if}
              {:else if conv.peerState === 'composing' || rttPreview}
                <TypingIndicator class="text-primary" />
                {#if rttPreview}
                  <!-- XEP-0301: the buffer the peer is composing, shown
                       instead of a static typing hint -->
                  <span class="text-primary truncate italic">{rttPreview}</span>
                {:else}
                  <span class="text-primary">{$LL.typing()}</span>
                {/if}
              {:else if contact}
                <span class={cn('truncate', presenceClass(contact.presence))}>
                  {presenceLabel(contact.presence)}{contact.presenceStatus
                    ? ` · ${contact.presenceStatus}`
                    : ''}
                </span>
              {:else}
                {conv.peerJid}
              {/if}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-0.5">
            {#if isRoom}
              <Button
                variant="ghost"
                size="icon"
                onclick={toggleBookmark}
                aria-label={peerBookmarked ? $LL.removeBookmark() : $LL.bookmarkRoom()}
                aria-pressed={peerBookmarked}
              >
                {#if peerBookmarked}
                  <BookmarkX class="text-primary size-4" />
                {:else}
                  <BookmarkIcon class="size-4" />
                {/if}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onclick={() => (showOccupants = !showOccupants)}
                aria-label={$LL.occupants({ count: conv.occupants.size })}
                aria-pressed={showOccupants}
              >
                <Users class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" onclick={leaveRoom} aria-label={$LL.leaveRoom()}>
                <LogOut class="size-4" />
              </Button>
              {#if conv.joined}
                <OptionsMenu
                  conversation={conv}
                  room
                  {peerBookmarked}
                  {peerBlocked}
                  {canEditSubject}
                  {canConfigure}
                  onNick={() => (nickOpen = true)}
                  onInvite={() => (inviteOpen = true)}
                  onSubject={() => (subjectOpen = true)}
                  onConfig={() => (configOpen = true)}
                  onToggleBookmark={toggleBookmark}
                  onBuzz={buzz}
                  onSetNotify={setNotify}
                  onSetEphemeral={setEphemeral}
                />
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
              <CallButtons {account} conversation={conv} />
              <OptionsMenu
                conversation={conv}
                room={false}
                {peerBookmarked}
                {peerBlocked}
                onToggleBookmark={toggleBookmark}
                onBuzz={buzz}
                onBlock={() => {
                  if (peerBlocked) account?.unblock(conv.peerJid)
                  else confirmBlock = true
                }}
                onSetNotify={setNotify}
                onSetEphemeral={setEphemeral}
              />
            {/if}
          </div>
        </div>
        <Separator />
        {#if isRoom}
          <RoomStatusBanner conversation={conv} />
        {/if}
        <MessageList
          bind:this={msgList}
          conversation={conv}
          selfJid={account?.jid ?? ''}
          onQuoteClick={(id) => msgList?.jumpTo(id)}
          onReply={(message) => {
            app.setComposer(conv.peerJid, { replyTo: message })
            app.focusComposer(conv.peerJid)
          }}
          onEdit={(message) => {
            if (message.outgoing) {
              app.setComposer(conv.peerJid, { editing: message })
              app.focusComposer(conv.peerJid)
            }
          }}
          onReact={reactToMessage}
          {senderLabel}
          onRetract={(message) => (retractTarget = message)}
          onCancelUpload={(message) => cancelUpload(message.id)}
          {canModerate}
          onModerate={(message) => {
            moderateReason = ''
            moderateTarget = message
          }}
          onDismiss={(message) => {
            if (!account) return
            app.chatsFor(account.jid).dropMessage(conv.peerJid, message.id)
          }}
          onLongPress={(message) => {
            sheetMessage = message
            sheetOpen = true
          }}
        />
        <Composer
          peerJid={conv.peerJid}
          kind={conv.kind}
          peerName={isRoom ? conv.peerJid.split('@')[0] : (contact?.name ?? undefined)}
        />
      </div>
      {#if isRoom && showOccupants && desktop}
        <aside class="w-56 shrink-0 border-l">
          <OccupantList conversation={conv} />
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
        {#if splitDms.length > 0}
          <optgroup label={$LL.conversations()}>
            {#each splitDms as choice (choice.jid)}
              <option value={choice.jid}>{choice.name}</option>
            {/each}
          </optgroup>
        {/if}
        {#if splitRooms.length > 0}
          <optgroup label={$LL.rooms()}>
            {#each splitRooms as choice (choice.jid)}
              <option value={choice.jid}>{choice.name}</option>
            {/each}
          </optgroup>
        {/if}
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
  {@const conv = conversation}
  <ChangeNickDialog bind:open={nickOpen} currentNick={conv.ourNick ?? ''} onSubmit={changeNick} />
  <SubjectDialog
    bind:open={subjectOpen}
    subject={conv.subject ?? ''}
    onSubmit={(subject) => account?.connection.setRoomSubject(conv.peerJid, subject)}
  />
  <InviteUserDialog bind:open={inviteOpen} onSubmit={sendInvite} />
  <RoomConfigDialog bind:open={configOpen} room={conv.peerJid} />

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

{#if conversation}
  {@const conv = conversation}
  <MessageSheet
    bind:open={sheetOpen}
    message={sheetMessage}
    {canModerate}
    onReply={(message) => {
      app.setComposer(conv.peerJid, { replyTo: message })
      app.focusComposer(conv.peerJid)
    }}
    onEdit={(message) => {
      if (message.outgoing) {
        app.setComposer(conv.peerJid, { editing: message })
        app.focusComposer(conv.peerJid)
      }
    }}
    onReact={reactToMessage}
    onRetract={(message) => (retractTarget = message)}
    onModerate={(message) => {
      moderateReason = ''
      moderateTarget = message
    }}
    onDismiss={(message) => {
      if (!account) return
      app.chatsFor(account.jid).dropMessage(conv.peerJid, message.id)
    }}
  />
{/if}

{#if isRoom && conversation && !desktop}
  {@const conv = conversation}
  <Sheet bind:open={showOccupants} title={$LL.occupants({ count: conv.occupants.size })}>
    <OccupantList conversation={conv} />
  </Sheet>
{/if}
