<script lang="ts">
  import { Mail } from '@lucide/svelte'

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

  import PeerAvatar from '../peer-avatar.svelte'

  let { invites }: { invites: PendingInvite[] } = $props()

  const account = $derived(accounts.active)

  // the invite open in the decline dialog. Null closes it
  let declining = $state<PendingInvite | null>(null)
  let declineReason = $state('')

  function accept(invite: PendingInvite) {
    if (!account) return
    const nick = account.jid.split('@')[0] ?? ''
    // direct invites carry the room password so protected rooms stay
    // joinable from the invite alone
    app.joinRoom(invite.room, nick, invite.password)
    account.dismissRoomInvite(invite)
    declining = null
    app.selectPeer(invite.room)
  }

  function decline(invite: PendingInvite) {
    // declines are always mediated through the room, even for direct
    // XEP-0249 invites
    account?.declineRoomInvite(invite, declineReason || undefined)
    declineReason = ''
    declining = null
  }
</script>

{#if invites.length > 0}
  <h2 class="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
    {$LL.roomInvites()}
  </h2>
  {#each invites as invite (`${invite.room}:${invite.from}`)}
    <div class="bg-card mb-2 flex min-w-0 flex-col gap-2 rounded-lg border p-3 shadow-xs">
      <div class="flex items-center gap-2.5">
        <PeerAvatar jid={invite.room} fallback={invite.room.slice(0, 2)} class="size-9 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{invite.room.split('@')[0]}</p>
          <p class="text-muted-foreground truncate text-xs">
            {$LL.invitedBy({ from: invite.from })}
          </p>
        </div>
        <Mail class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </div>
      <p class="text-muted-foreground truncate text-xs">{invite.room}</p>
      {#if invite.reason}
        <p class="text-muted-foreground border-border border-l-2 pl-2 text-xs break-words italic">
          {invite.reason}
        </p>
      {/if}
      <div class="flex gap-2">
        <Button size="sm" class="flex-1" onclick={() => accept(invite)}>
          {$LL.join()}
        </Button>
        <Button size="sm" variant="outline" class="flex-1" onclick={() => (declining = invite)}>
          {$LL.decline()}
        </Button>
      </div>
    </div>
  {/each}
{/if}

<Dialog
  open={declining !== null}
  onOpenChange={(o) => {
    if (!o) declining = null
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.declineInviteTitle()}</DialogTitle>
      {#if declining}
        <DialogDescription>
          {$LL.invitedToRoom({ from: declining.from, room: declining.room })}
        </DialogDescription>
      {/if}
    </DialogHeader>
    {#if declining}
      <div class="grid gap-2">
        <Label for="decline-reason">{$LL.reasonOptional()}</Label>
        <Input id="decline-reason" bind:value={declineReason} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onclick={() => (declining = null)}>{$LL.cancel()}</Button>
        <Button variant="destructive" onclick={() => declining && decline(declining)}>
          {$LL.decline()}
        </Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
