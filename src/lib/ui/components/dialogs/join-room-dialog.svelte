<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { bareJid, isValidBareJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'
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

  const roomValid = $derived(isValidBareJid(room))
  const canJoin = $derived(roomValid && nick.trim().length > 0)

  // default nick: the local part of the account JID
  $effect(() => {
    if (app.joinRoomOpen && !nick) {
      nick = accounts.active?.jid.split('@')[0] ?? ''
    }
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const account = accounts.active
    if (!account || !canJoin) return
    const bare = bareJid(room)
    account.joinRoom(bare, nick.trim())
    app.chatsFor(account.jid).open(bare, 'muc')
    app.joinRoomOpen = false
    app.selectPeer(bare)
    room = ''
  }
</script>

<Dialog bind:open={app.joinRoomOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.joinRoom()}</DialogTitle>
    </DialogHeader>
    <form onsubmit={submit} class="flex flex-col gap-4">
      <div class="grid gap-2">
        <Label for="room-jid">{$LL.roomJid()}</Label>
        <Input
          id="room-jid"
          bind:value={room}
          placeholder={$LL.roomJidPlaceholder()}
          aria-invalid={room.length > 0 && !roomValid}
          required
        />
      </div>
      <div class="grid gap-2">
        <Label for="room-nick">{$LL.nickname()}</Label>
        <Input id="room-nick" bind:value={nick} placeholder={$LL.nicknamePlaceholder()} required />
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
