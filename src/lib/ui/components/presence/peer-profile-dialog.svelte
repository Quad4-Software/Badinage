<script lang="ts">
  import { Copy, MessageCircle } from '@lucide/svelte'

  import type { Vcard } from '$lib/core/xmpp/stanzas'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import PeerAvatar from '$lib/ui/components/chat/peer-avatar.svelte'
  import { copyText } from '$lib/ui/clipboard'
  import { presenceClass, presenceLabel } from '$lib/ui/presence'
  import { Button } from '$lib/ui/primitives/button'
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { bareJid, jidResource } from '$lib/utils/jid'
  import { cn } from '$lib/utils/cn'

  // read-only profile card opened from a sender avatar or nick. The key
  // is the avatar address: a bare jid for contacts, a room/nick occupant
  // key for room members
  const account = $derived(accounts.active)
  const target = $derived(app.peerProfile ?? '')
  const open = $derived(app.peerProfile !== null && app.peerProfile !== '')

  // a slash means the key is room/nick, not a contact bare jid
  const room = $derived(target.includes('/') ? bareJid(target) : undefined)
  const nick = $derived(room ? jidResource(target) : undefined)
  const conversation = $derived(
    room && account ? app.chatsFor(account.jid).conversations.get(room) : undefined
  )
  const occupant = $derived(nick ? conversation?.occupants.get(nick) : undefined)
  const contact = $derived(
    target && !room ? account?.roster.find((c) => c.jid === target) : undefined
  )

  // the synthetic nick@host jid of an irc peer is noise, so the card
  // shows the bare nick and hides the address row
  const isIrc = $derived(account?.options.protocol === 'irc')
  const fallbackName = $derived(
    target ? (nick ?? (isIrc ? (target.split('@')[0] ?? target) : target)) : ''
  )

  let card = $state<Vcard | null>(null)

  // the wire fetch runs only when the card actually opens: list rows
  // never fan out into vcard queries
  $effect(() => {
    const jid = open ? target : ''
    const acc = account
    card = null
    if (!jid || !acc || !acc.caps.profile || acc.status !== 'connected') return
    acc.connection.vcard.fetchPeer(jid, (vcard) => {
      if (app.peerProfile === jid) card = vcard
    })
  })

  const name = $derived(
    occupant?.nick ?? contact?.name ?? card?.fn ?? card?.nickname ?? fallbackName
  )
  const presence = $derived(occupant?.presence ?? contact?.presence)
  const statusText = $derived(contact?.presenceStatus ?? '')
  const address = $derived(
    isIrc ? undefined : (occupant?.jid ?? (room ? target : (contact?.jid ?? target)))
  )
  const role = $derived(
    occupant?.role === 'moderator'
      ? $LL.roleModerator()
      : occupant?.affiliation === 'admin' || occupant?.affiliation === 'owner'
        ? $LL.roleAdmin()
        : ''
  )

  // occupants in anonymous rooms have no real jid to message
  const messageTarget = $derived(
    room ? (occupant?.jid ? bareJid(occupant.jid) : undefined) : target
  )
  const canMessage = $derived(
    messageTarget !== undefined &&
      messageTarget !== '' &&
      account !== undefined &&
      !occupant?.self &&
      bareJid(account.jid) !== bareJid(messageTarget)
  )

  function message() {
    const peer = messageTarget
    if (peer === undefined) return
    app.peerProfile = null
    app.selectPeer(peer)
  }
</script>

<Dialog
  {open}
  onOpenChange={(o) => {
    if (!o) app.peerProfile = null
  }}
>
  <DialogContent class="sm:max-w-sm">
    <DialogHeader>
      <DialogTitle>{$LL.viewProfile()}</DialogTitle>
    </DialogHeader>
    {#if target}
      <div class="flex flex-col items-center gap-3 text-center">
        <PeerAvatar jid={target} fallback={name.slice(0, 2)} force class="size-20" />
        <div class="flex min-w-0 flex-col items-center gap-0.5">
          <p class="flex items-center gap-2 text-lg font-medium break-all">
            {name}
            {#if role}
              <span
                class="bg-primary/10 text-primary shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium tracking-wide uppercase"
              >
                {role}
              </span>
            {/if}
          </p>
          {#if presence}
            <p class={cn('text-sm', presenceClass(presence))}>
              {presenceLabel(presence)}{statusText ? ` · ${statusText}` : ''}
            </p>
          {/if}
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-1.5 text-sm">
        {#if address}
          <div class="flex min-w-0 items-center gap-1">
            <span class="min-w-0 flex-1 truncate">{address}</span>
            <Button
              variant="ghost"
              size="icon"
              class="size-7 shrink-0"
              aria-label={$LL.copyAddress()}
              onclick={() => void copyText(address)}
            >
              <Copy class="size-3.5" />
            </Button>
          </div>
        {/if}
        {#if room}
          <p class="text-muted-foreground truncate">{$LL.memberOfRoom({ room })}</p>
        {/if}
        {#if card?.fn && card.fn !== name}
          <p class="break-words">{card.fn}</p>
        {/if}
        {#if card?.desc}
          <p class="text-muted-foreground break-words">{card.desc}</p>
        {/if}
      </div>

      {#if canMessage}
        <DialogFooter>
          <Button onclick={message}>
            <MessageCircle class="size-4" />
            {$LL.messageOccupant({ nick: name })}
          </Button>
        </DialogFooter>
      {/if}
    {/if}
  </DialogContent>
</Dialog>
