<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Ban, EllipsisVertical, Search, UserX } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import type { Conversation, RoomOccupant } from '$lib/state/chats.svelte'
  import { contextArea } from '$lib/ui/components/context-menu/area'
  import { Input } from '$lib/ui/primitives/input'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { cn } from '$lib/utils/cn'
  import { presenceClass, presenceLabel } from '$lib/ui/presence'

  import ConfirmDialog from '../dialogs/confirm-dialog.svelte'
  import PeerAvatar from './peer-avatar.svelte'
  import { occupantMenu } from './sidebar/row-menu.svelte'

  let { conversation }: { conversation: Conversation } = $props()

  let query = $state('')
  // moderation dialog state. The target is captured when the menu item
  // fires because the row can unmount before the confirm runs
  let kickTarget = $state<RoomOccupant | null>(null)
  let kickReason = $state('')
  let banTarget = $state<RoomOccupant | null>(null)
  let banReason = $state('')

  const account = $derived(accounts.active)
  // our own occupant record decides which moderation controls exist
  const selfOccupant = $derived([...conversation.occupants.values()].find((o) => o.self))

  // XEP-0045: moderators kick participants and visitors. Admins and
  // owners ban by real jid, which only non-anonymous rooms disclose
  const canKick = (occupant: RoomOccupant) =>
    selfOccupant?.role === 'moderator' && !occupant.self && occupant.role !== 'moderator'
  const canBan = (occupant: RoomOccupant) =>
    (selfOccupant?.affiliation === 'admin' || selfOccupant?.affiliation === 'owner') &&
    !occupant.self &&
    occupant.affiliation !== 'owner' &&
    occupant.jid !== undefined

  const roleRank = (role: string) => (role === 'moderator' ? 0 : role === 'participant' ? 1 : 2)

  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...conversation.occupants.values()]
      .filter((o) => !q || o.nick.toLowerCase().includes(q))
      .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.nick.localeCompare(b.nick))
    const out: { title: string; members: RoomOccupant[] }[] = [
      { title: $LL.groupModerators(), members: [] },
      { title: $LL.groupParticipants(), members: [] },
      { title: $LL.groupVisitors(), members: [] }
    ]
    for (const occupant of sorted) out[roleRank(occupant.role)]?.members.push(occupant)
    return out.filter((g) => g.members.length > 0)
  })

  const badge = (occupant: RoomOccupant) =>
    occupant.role === 'moderator'
      ? $LL.roleModerator()
      : occupant.affiliation === 'admin' || occupant.affiliation === 'owner'
        ? $LL.roleAdmin()
        : ''

  function doKick() {
    if (!kickTarget) return
    account?.connection.kickOccupant(conversation.peerJid, kickTarget.nick, kickReason || undefined)
    kickReason = ''
  }

  function doBan() {
    const jid = banTarget?.jid
    if (!jid) return
    account?.connection.banOccupant(conversation.peerJid, jid, banReason || undefined)
    banReason = ''
  }
</script>

<div class="flex h-full min-w-0 flex-col">
  <p class="text-muted-foreground p-3 pb-2 text-xs font-medium tracking-wide uppercase">
    {$LL.occupants({ count: conversation.occupants.size })}
  </p>
  <div class="px-3 pb-2">
    <div class="relative">
      <Search
        class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
      />
      <Input
        bind:value={query}
        placeholder={$LL.searchMembers()}
        aria-label={$LL.searchMembers()}
        class="h-8 pl-8 text-sm"
      />
    </div>
  </div>
  <ScrollArea class="flex-1">
    <ul class="flex flex-col px-2 pb-3">
      {#each groups as group (group.title)}
        <li
          class="text-muted-foreground px-2 pt-3 pb-1 text-xs font-medium tracking-wide uppercase"
        >
          {group.title} · {group.members.length}
        </li>
        {#each group.members as occupant (occupant.nick)}
          <li
            class="group hover:bg-accent flex items-center gap-2.5 rounded-md px-2 py-1.5"
            {@attach contextArea({
              section: 'chat.occupant',
              payload: occupant,
              items: () => occupantMenu(occupant, conversation, account)
            })}
          >
            <button
              type="button"
              class="focus-visible:ring-ring shrink-0 cursor-pointer rounded-full transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:outline-none"
              aria-label={$LL.viewProfileOf({ name: occupant.nick })}
              onclick={() => (app.peerProfile = `${conversation.peerJid}/${occupant.nick}`)}
            >
              <PeerAvatar
                jid={`${conversation.peerJid}/${occupant.nick}`}
                fallback={occupant.nick.slice(0, 2)}
                class="size-7 text-[0.65rem]"
              />
            </button>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1.5">
                <span
                  class="truncate text-sm"
                  class:font-medium={occupant.self}
                  class:text-muted-foreground={occupant.presence !== 'online' &&
                    occupant.presence !== 'chat'}
                >
                  {occupant.nick}
                </span>
                {#if occupant.self}
                  <span class="text-muted-foreground text-xs">({$LL.you().toLowerCase()})</span>
                {/if}
              </span>
              <span class="block truncate text-xs">
                {#if occupant.jid}
                  <span class="text-muted-foreground">{occupant.jid} · </span>
                {/if}<span class={presenceClass(occupant.presence)}
                  >{presenceLabel(occupant.presence)}</span
                >
              </span>
            </span>
            {#if badge(occupant)}
              <span
                class={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium tracking-wide uppercase',
                  occupant.role === 'moderator'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {badge(occupant)}
              </span>
            {/if}
            {#if canKick(occupant) || canBan(occupant)}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  class="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-6 shrink-0 items-center justify-center rounded opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
                  aria-label={$LL.occupantOptions()}
                >
                  <EllipsisVertical class="size-4" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    class="bg-popover text-popover-foreground z-50 min-w-40 rounded-md border p-1 shadow-md"
                    sideOffset={4}
                    align="end"
                  >
                    {#if canKick(occupant)}
                      <DropdownMenu.Item
                        class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
                        onSelect={() => {
                          kickReason = ''
                          kickTarget = occupant
                        }}
                      >
                        <UserX class="size-4" />
                        {$LL.kick()}
                      </DropdownMenu.Item>
                    {/if}
                    {#if canBan(occupant)}
                      <DropdownMenu.Item
                        class="data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none"
                        onSelect={() => {
                          banReason = ''
                          banTarget = occupant
                        }}
                      >
                        <Ban class="size-4" />
                        {$LL.ban()}
                      </DropdownMenu.Item>
                    {/if}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            {/if}
          </li>
        {/each}
      {:else}
        <li class="text-muted-foreground px-2 py-4 text-sm">{$LL.noMembersFound()}</li>
      {/each}
    </ul>
  </ScrollArea>
</div>

<ConfirmDialog
  open={kickTarget !== null}
  onOpenChange={(o) => {
    if (!o) kickTarget = null
  }}
  title={$LL.kickOccupantTitle({ nick: kickTarget?.nick ?? '' })}
  confirmLabel={$LL.kick()}
  destructive
  onConfirm={doKick}
>
  <span class="block">
    {$LL.kickOccupantDescription({ nick: kickTarget?.nick ?? '' })}
  </span>
  <Input
    bind:value={kickReason}
    placeholder={$LL.reasonOptional()}
    aria-label={$LL.reasonOptional()}
    class="mt-2"
  />
</ConfirmDialog>

<ConfirmDialog
  open={banTarget !== null}
  onOpenChange={(o) => {
    if (!o) banTarget = null
  }}
  title={$LL.banOccupantTitle({ jid: banTarget?.jid ?? '' })}
  confirmLabel={$LL.ban()}
  destructive
  onConfirm={doBan}
>
  <span class="block">
    {$LL.banOccupantDescription({ jid: banTarget?.jid ?? '' })}
  </span>
  <Input
    bind:value={banReason}
    placeholder={$LL.reasonOptional()}
    aria-label={$LL.reasonOptional()}
    class="mt-2"
  />
</ConfirmDialog>
