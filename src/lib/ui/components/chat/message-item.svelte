<script lang="ts">
  import { Eye, File, Lock, MapPin, SmilePlus, Undo2, X } from '@lucide/svelte'

  import { GEOLOC_TILE_TEMPLATE, GEOLOC_TILE_ZOOM, REACTION_TOOLTIP_CAP } from '$lib/constants'
  import LL from '$lib/i18n/i18n-svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/ui/primitives/tooltip'
  import { cn } from '$lib/utils/cn'
  import { consistentInk } from '$lib/utils/protocol/color'
  import { isEmojiOnly } from '$lib/utils/emoji'
  import { isGeoUri, osmUrl, tileFor, tileUrl } from '$lib/utils/protocol/geo'
  import { meAction } from '$lib/utils/message-commands'
  import { reactionSenderNames } from '$lib/utils/reactions'

  import PeerAvatar from './peer-avatar.svelte'
  import MessageAttachments from './message-attachments.svelte'
  import MessageBody from './message-body.svelte'
  import MessageMeta from './message-meta.svelte'
  import MessageItemActions from './message-item/actions.svelte'
  import EmojiPicker from './emoji-picker.svelte'
  import { anchorStyle, portal, tick } from '$lib/ui/interactions'
  import { longPress } from '$lib/ui/long-press'
  import { messageMenu } from './message-item/menu.svelte'

  interface Props {
    message: ChatMessage
    // grouping hints from message-list: true on the first bubble of a run
    showNick?: boolean
    showAvatar?: boolean
    avatarName?: string
    // address the sender avatar is resolved under. Force fetches even
    // without a presence photo hash hint (dm peers)
    avatarJid?: string
    avatarForce?: boolean
    // bare jid (dm) or nick (muc) used to mark our own reaction pills
    selfJid?: string
    // maps a reaction sender key (bare jid or muc nick) to a display name
    senderLabel?: ((sender: string) => string) | undefined
    onQuoteClick?: ((id: string) => void) | undefined
    onReply?: ((message: ChatMessage) => void) | undefined
    onEdit?: ((message: ChatMessage) => void) | undefined
    onReact?: ((emoji: string) => void) | undefined
    onRetract?: ((message: ChatMessage) => void) | undefined
    onCancelUpload?: ((message: ChatMessage) => void) | undefined
    // XEP-0425: shown only when our own room role allows moderation
    canModerate?: boolean
    onModerate?: ((message: ChatMessage) => void) | undefined
    // removes the message. Only rendered for undecryptable tombstones
    onDismiss?: ((message: ChatMessage) => void) | undefined
    // press-and-hold or right click on the bubble, for the touch sheet
    onLongPress?: ((message: ChatMessage) => void) | undefined
  }

  let {
    message,
    showNick = false,
    showAvatar = false,
    avatarName = '',
    avatarJid = '',
    avatarForce = false,
    selfJid = '',
    senderLabel,
    onQuoteClick,
    onReply,
    onEdit,
    onReact,
    onRetract,
    onCancelUpload,
    canModerate = false,
    onModerate,
    onDismiss,
    onLongPress
  }: Props = $props()

  let spoilerRevealed = $state(false)

  // senders put the oob url in the body as a fallback. When the body is
  // exactly that url the attachment block already renders it. Same for
  // the geo uri fallback that accompanies a geoloc element.
  const bodyIsAttachmentUrl = $derived(
    (message.attachments ?? []).some((a) => a.url === message.body.trim()) ||
      (message.geoloc !== undefined && isGeoUri(message.body))
  )
  const geoTile = $derived(
    message.geoloc ? tileFor(message.geoloc.lat, message.geoloc.lon, GEOLOC_TILE_ZOOM) : undefined
  )
  const geoTileUrl = $derived(
    message.geoloc && settings.current.mapPreviews
      ? tileUrl(GEOLOC_TILE_TEMPLATE, message.geoloc.lat, message.geoloc.lon, GEOLOC_TILE_ZOOM)
      : ''
  )
  const reactionEntries = $derived(Object.entries(message.reactions))
  const jumbo = $derived(isEmojiOnly(message.body))
  const initials = $derived((avatarName || message.nick || '?').slice(0, 2))
  // XEP-0245: a "/me " body renders as an italic action line
  const meText = $derived(meAction(message.body))
  const meName = $derived(message.nick ?? (message.outgoing ? $LL.you() : avatarName))
  const uploadPercent = $derived(Math.round((message.uploadProgress ?? 0) * 100))

  const actionClass =
    'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 items-center justify-center rounded'

  // the picker portals to body and anchors to the trigger rect: inside
  // the scrollable list an absolute wrapper got clipped against the
  // composer and could stack under sibling panes
  let pickerOpen = $state(false)
  let pickerStyle = $state('')
  let pickerTrigger = $state<HTMLElement | null>(null)
  let pickerEl = $state<HTMLElement | null>(null)
  let bubbleEl = $state<HTMLElement | null>(null)
  const menuHandlers = $derived({ onReply, onEdit, onRetract, onModerate, onDismiss })

  function openPicker(anchor: 'top' | 'bottom', trigger: HTMLElement) {
    if (pickerOpen) return closePicker()
    pickerTrigger = trigger
    pickerStyle = anchorStyle(trigger.getBoundingClientRect(), {
      anchor,
      width: 288,
      height: 300,
      alignRight: anchor === 'top' || message.outgoing
    })
    pickerOpen = true
  }

  // the picker autofocuses its search on open, so closing while focus is
  // inside has to hand it back to the trigger or it drops to the body
  function closePicker() {
    if (pickerEl?.contains(document.activeElement)) pickerTrigger?.focus()
    pickerOpen = false
    pickerTrigger = null
  }

  function senderNames(senders: string[]): string {
    const { names, extra } = reactionSenderNames(
      senders,
      (sender) => senderLabel?.(sender) ?? sender,
      REACTION_TOOLTIP_CAP
    )
    return extra > 0 ? [...names, $LL.moreSenders({ count: extra })].join(', ') : names.join(', ')
  }
</script>

{#snippet bodyContent()}
  {#if meText !== null}
    <p class="break-words italic">* {meName} {meText}</p>
  {:else if message.body && !bodyIsAttachmentUrl}
    {#if jumbo}
      <p class="text-4xl leading-tight break-words">{message.body}</p>
    {:else}
      <MessageBody body={message.body} unstyled={message.unstyled} />
    {/if}
  {/if}
{/snippet}

<div
  class={cn('group flex items-end gap-2', message.outgoing && 'justify-end')}
  {@attach messageMenu(message, canModerate, () => bubbleEl, openPicker, menuHandlers)}
>
  {#if !message.outgoing}
    {#if showAvatar}
      <PeerAvatar jid={avatarJid} fallback={initials} force={avatarForce} class="size-7" />
    {:else}
      <!-- keeps continuation bubbles aligned under the avatar column -->
      <span class="size-7 shrink-0" aria-hidden="true"></span>
    {/if}
  {/if}

  <div
    class={cn('flex max-w-[75%] min-w-0 flex-col', message.outgoing ? 'items-end' : 'items-start')}
  >
    {#if showNick && !message.outgoing && message.nick}
      {@const ink = consistentInk(message.nick)}
      <!-- XEP-0392: stable per-nick color so senders stay scannable -->
      <span
        class="peer-ink mb-0.5 ml-1 text-xs"
        style="--peer-ink-light: {ink.light}; --peer-ink-dark: {ink.dark}"
      >
        {message.nick}
      </span>
    {/if}

    <div
      class="relative max-w-full"
      bind:this={bubbleEl}
      {@attach longPress(() => {
        if (!message.retracted && !message.pending) onLongPress?.(message)
      })}
    >
      <div
        class={cn(
          'msg-bubble density-text-sm rounded-2xl px-3 py-[var(--density-row-pad)]',
          message.outgoing
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted rounded-bl-sm',
          message.mentionsMe && 'ring-primary/60 ring-2'
        )}
      >
        {#if message.retracted}
          <!-- the row survives retraction so replies still anchor -->
          <p
            class={cn(
              'flex items-center gap-1.5 italic',
              message.outgoing ? 'text-primary-foreground/70' : 'text-foreground/70'
            )}
          >
            <Undo2 class="size-3.5 shrink-0" />
            {$LL.messageRetracted()}{message.retractReason ? ` · ${message.retractReason}` : ''}
          </p>
        {:else}
          {#if message.replyTo}
            <button
              type="button"
              class={cn(
                'mb-1 block w-full rounded-md border-l-2 py-1 pr-1 pl-2 text-left text-xs',
                message.outgoing
                  ? 'border-primary-foreground/50 bg-primary-foreground/10'
                  : 'border-primary/60 bg-background/50'
              )}
              onclick={() => message.replyTo && onQuoteClick?.(message.replyTo.id)}
            >
              <span class="block truncate font-medium">{message.replyTo.from}</span>
              {#if message.replyTo.quote}
                <span
                  class={cn(
                    'line-clamp-2 block',
                    message.outgoing ? 'text-primary-foreground/70' : 'text-foreground/70'
                  )}
                >
                  {message.replyTo.quote}
                </span>
              {/if}
            </button>
          {/if}

          {#if message.pending}
            <div class="flex min-w-48 items-center gap-2">
              <File class="size-4 shrink-0" />
              <div class="min-w-0 flex-1">
                <span class="block truncate">{message.pendingName ?? $LL.fileAttachment()}</span>
                <div
                  role="progressbar"
                  aria-valuenow={uploadPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={$LL.uploading()}
                  class="bg-primary-foreground/30 mt-1 h-1 rounded-full"
                >
                  <div
                    class="bg-primary-foreground h-full rounded-full transition-[width]"
                    style:width="{uploadPercent}%"
                  ></div>
                </div>
              </div>
              <button
                type="button"
                class={actionClass}
                aria-label={$LL.cancelUpload()}
                onclick={() => onCancelUpload?.(message)}
              >
                <X class="size-3.5" />
              </button>
            </div>
          {:else}
            {#if message.attachments?.length}
              <div class="mb-1">
                <MessageAttachments attachments={message.attachments} />
              </div>
            {/if}

            {#if message.undecryptable}
              <div
                class={cn(
                  'flex items-center gap-1.5 italic',
                  message.outgoing ? 'text-primary-foreground/70' : 'text-foreground/70'
                )}
              >
                <Lock class="size-3.5 shrink-0" />
                <span class="min-w-0">
                  {$LL.couldNotDecrypt()}
                  {#if message.keyRequested}
                    <span class="mt-0.5 block text-xs not-italic">{$LL.keyRequested()}</span>
                  {/if}
                </span>
              </div>
            {:else if message.geoloc}
              <!-- XEP-0080: a location card. The tile preview is
                   opt-in because it fetches from a tile server -->
              <a
                href={osmUrl(message.geoloc.lat, message.geoloc.lon)}
                target="_blank"
                rel="noopener noreferrer"
                class={cn(
                  'mb-1 block w-52 overflow-hidden rounded-md border text-left',
                  message.outgoing ? 'border-primary-foreground/30' : 'border-border'
                )}
              >
                {#if geoTileUrl && geoTile}
                  <span class="relative block h-28 w-52 overflow-hidden">
                    <!-- tile is 256px. Offset it so the pin lands at the
                         center of the 208x112 window -->
                    <img
                      src={geoTileUrl}
                      alt=""
                      class="absolute h-64 w-64 max-w-none"
                      style:left="{104 - geoTile.pinX}px"
                      style:top="{56 - geoTile.pinY}px"
                    />
                    <MapPin
                      class="text-destructive absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-full"
                    />
                  </span>
                {/if}
                <span class="flex items-center gap-1.5 px-2 py-1.5 text-xs">
                  <MapPin class="size-3.5 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">{$LL.sharedLocation()}</span>
                  <span class="tabular-nums opacity-70">
                    {message.geoloc.lat.toFixed(5)}, {message.geoloc.lon.toFixed(5)}
                  </span>
                </span>
              </a>
              {@render bodyContent()}
            {:else if message.spoilerHint !== undefined}
              <!-- XEP-0382: the body stays hidden until the reveal control -->
              <button
                type="button"
                aria-expanded={spoilerRevealed}
                class={cn(
                  'mb-1 flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs',
                  message.outgoing
                    ? 'border-primary-foreground/50'
                    : 'border-foreground/30 hover:bg-accent'
                )}
                onclick={() => (spoilerRevealed = !spoilerRevealed)}
              >
                <Eye class="size-3.5 shrink-0" />
                {message.spoilerHint || $LL.spoiler()}
              </button>
              {#if spoilerRevealed}
                {@render bodyContent()}
              {/if}
            {:else}
              {@render bodyContent()}
            {/if}
          {/if}
        {/if}

        {#if !message.pending}
          <MessageMeta {message} />
        {/if}
      </div>

      <MessageItemActions
        {message}
        {canModerate}
        {pickerOpen}
        onOpenPicker={openPicker}
        {onReply}
        {onEdit}
        {onRetract}
        {onModerate}
        {onDismiss}
      />
    </div>

    {#if pickerOpen}
      <div {@attach portal} bind:this={pickerEl} class="fixed z-50" style={pickerStyle}>
        <EmojiPicker onPick={(emoji) => onReact?.(emoji)} onClose={closePicker} />
      </div>
    {/if}

    {#if reactionEntries.length > 0}
      <div class={cn('mt-1 flex flex-wrap gap-1', message.outgoing && 'justify-end')}>
        {#each reactionEntries as [emoji, senders] (emoji)}
          {@const mine = selfJid !== '' && senders.includes(selfJid)}
          <Tooltip>
            <TooltipTrigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  class={cn(
                    'flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-transform active:scale-95',
                    mine
                      ? 'bg-primary/15 text-primary ring-primary/40 ring-1 ring-inset'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  )}
                  aria-pressed={mine}
                  onclick={() => {
                    tick()
                    onReact?.(emoji)
                  }}
                >
                  {#key senders.length}
                    <span class="reaction-pop inline-block">{emoji}</span>
                  {/key}
                  <span class="tabular-nums">{senders.length}</span>
                </button>
              {/snippet}
            </TooltipTrigger>
            <TooltipContent>{senderNames(senders)}</TooltipContent>
          </Tooltip>
        {/each}
        {#if !message.retracted && !message.pending}
          <button
            type="button"
            class="msg-hover-only text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 items-center justify-center rounded-full border border-dashed opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={$LL.react()}
            onclick={(event) => openPicker('bottom', event.currentTarget)}
          >
            <SmilePlus class="size-3.5" />
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
