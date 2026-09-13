<script lang="ts">
  import { Search } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Conversation, RoomOccupant } from '$lib/state/chats.svelte'
  import { Input } from '$lib/ui/primitives/input'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { cn } from '$lib/utils/cn'
  import { presenceLabel } from '$lib/ui/presence'

  import PresenceDot from '../presence/presence-dot.svelte'
  import PeerAvatar from './peer-avatar.svelte'

  let { conversation }: { conversation: Conversation } = $props()

  let query = $state('')

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
          <li class="hover:bg-accent flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <span class="relative shrink-0">
              <PeerAvatar
                jid={`${conversation.peerJid}/${occupant.nick}`}
                fallback={occupant.nick.slice(0, 2)}
                class="size-7 text-[0.65rem]"
              />
              <PresenceDot
                presence={occupant.presence}
                class="ring-background absolute -right-0.5 -bottom-0.5 ring-2"
              />
            </span>
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
              <span class="text-muted-foreground block truncate text-xs">
                {presenceLabel(occupant.presence)}
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
          </li>
        {/each}
      {:else}
        <li class="text-muted-foreground px-2 py-4 text-sm">{$LL.noMembersFound()}</li>
      {/each}
    </ul>
  </ScrollArea>
</div>
