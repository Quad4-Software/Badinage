<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts, type PendingInvite } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'

  let { invites }: { invites: PendingInvite[] } = $props()

  const account = $derived(accounts.active)

  // the invite open in the dialog; null closes it
  let current = $state<PendingInvite | null>(null)
  let declineReason = $state('')

  function accept(invite: PendingInvite) {
    if (!account) return
    const nick = account.jid.split('@')[0] ?? ''
    // direct invites carry the room password so protected rooms stay
    // joinable from the invite alone
    app.joinRoom(invite.room, nick, invite.password)
    account.dismissRoomInvite(invite)
    current = null
    app.selectPeer(invite.room)
  }

  function decline(invite: PendingInvite) {
    // declines are always mediated through the room, even for direct
    // XEP-0249 invites
    account?.declineRoomInvite(invite, declineReason || undefined)
    declineReason = ''
    current = null
  }
</script>

{#if invites.length > 0}
  <h2 class="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
    {$LL.roomInvites()}
  </h2>
  {#each invites as invite (`${invite.room}:${invite.from}`)}
    <button
      type="button"
      class="bg-muted/50 hover:bg-accent flex min-w-0 flex-col gap-1 rounded-md px-3 py-2 text-left"
      onclick={() => (current = invite)}
    >
      <p class="text-sm break-all">
        {$LL.invitedToRoom({ from: invite.from, room: invite.room })}
      </p>
      {#if invite.reason}
        <p class="text-muted-foreground text-xs break-words italic">{invite.reason}</p>
      {/if}
    </button>
  {/each}
{/if}

<Dialog
  open={current !== null}
  onOpenChange={(o) => {
    if (!o) current = null
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.roomInvites()}</DialogTitle>
      {#if current}
        <DialogDescription>
          {$LL.invitedToRoom({ from: current.from, room: current.room })}
        </DialogDescription>
      {/if}
    </DialogHeader>
    {#if current}
      {@const invite = current}
      {#if invite.reason}
        <p class="text-muted-foreground text-sm break-words italic">{invite.reason}</p>
      {/if}
      <div class="grid gap-2">
        <Label for="decline-reason">{$LL.reasonOptional()}</Label>
        <Input id="decline-reason" bind:value={declineReason} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onclick={() => decline(invite)}>{$LL.decline()}</Button>
        <Button onclick={() => accept(invite)}>{$LL.join()}</Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
