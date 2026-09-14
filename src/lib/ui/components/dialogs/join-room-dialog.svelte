<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { explore } from '$lib/state/explore'
  import { isValidIrcChannel, ircChannelJid } from '$lib/utils/irc'
  import { bareJid, isValidBareJid, jidDomain } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'
  import { Checkbox } from '$lib/ui/primitives/checkbox'
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'

  let room = $state('')
  let nick = $state('')
  let password = $state('')
  let saveBookmark = $state(false)

  const account = $derived(accounts.active)
  const isIrc = $derived(account?.options.protocol === 'irc')
  const roomValid = $derived(isIrc ? isValidIrcChannel(room.trim()) : isValidBareJid(room))
  // the nick is global on IRC so the field is hidden there and the
  // account nick is used. XMPP still asks for a per-room nick
  const canJoin = $derived(roomValid && (isIrc || nick.trim().length > 0))

  // default nick: the local part of the account JID. A room address
  // handed over by the explore dialog or an xmpp:?join link prefills
  // the jid field.
  $effect(() => {
    if (app.joinRoomOpen && !nick) {
      nick = accounts.active?.jid.split('@')[0] ?? ''
    }
    if (app.joinRoomOpen && explore.joinPrefill) {
      room = explore.joinPrefill.room
      explore.joinPrefill = null
    }
    if (app.joinRoomOpen && app.pendingLink?.kind === 'join') {
      room = app.pendingLink.jid
      app.pendingLink = null
    }
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!account || !canJoin) return
    const bare = isIrc ? ircChannelJid(room.trim(), jidDomain(account.jid)) : bareJid(room)
    // connection.jid tracks the live nick, including a 433 fallback
    const roomNick = isIrc ? (account.connection.jid.split('@')[0] ?? 'me') : nick.trim()
    // goes through the app store so nick and password are remembered
    // for watchdog rejoins and error-banner retries
    app.joinRoom(bare, roomNick, password || undefined)
    if (saveBookmark) {
      account.addBookmark({
        jid: bare,
        kind: 'conference',
        name: bare.split('@')[0],
        autojoin: true,
        nick: nick.trim(),
        password: password || undefined
      })
    }
    app.chatsFor(account.jid).open(bare, 'muc')
    app.joinRoomOpen = false
    app.selectPeer(bare)
    room = ''
    password = ''
    saveBookmark = false
  }
</script>

<Dialog bind:open={app.joinRoomOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{isIrc ? $LL.joinChannel() : $LL.joinRoom()}</DialogTitle>
    </DialogHeader>
    <form onsubmit={submit} class="flex flex-col gap-4">
      <div class="grid gap-2">
        <Label for="room-jid">{isIrc ? $LL.channelName() : $LL.roomJid()}</Label>
        <Input
          id="room-jid"
          bind:value={room}
          placeholder={isIrc ? $LL.channelPlaceholder() : $LL.roomJidPlaceholder()}
          aria-invalid={room.length > 0 && !roomValid}
          required
        />
      </div>
      {#if !isIrc}
        <div class="grid gap-2">
          <Label for="room-nick">{$LL.nickname()}</Label>
          <Input
            id="room-nick"
            bind:value={nick}
            placeholder={$LL.nicknamePlaceholder()}
            required
          />
        </div>
      {/if}
      <div class="grid gap-2">
        <Label for="room-password"
          >{isIrc ? $LL.channelKeyOptional() : $LL.roomPasswordOptional()}</Label
        >
        <Input id="room-password" bind:value={password} type="password" />
      </div>
      <div class="flex items-center gap-2">
        <Checkbox id="room-bookmark" bind:checked={saveBookmark} />
        <Label for="room-bookmark" class="text-sm font-normal">
          {isIrc ? $LL.bookmarkChannel() : $LL.bookmarkRoom()}
        </Label>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onclick={() => (app.joinRoomOpen = false)}>
          {$LL.cancel()}
        </Button>
        <Button type="submit" disabled={!canJoin}>{$LL.join()}</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
