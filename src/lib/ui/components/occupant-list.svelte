<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import type { Conversation } from '$lib/state/chats.svelte'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'

  import PresenceDot from './presence-dot.svelte'

  let { conversation }: { conversation: Conversation } = $props()

  const occupants = $derived(
    [...conversation.occupants.values()].sort((a, b) => {
      const rank = (role: string) => (role === 'moderator' ? 0 : role === 'participant' ? 1 : 2)
      return rank(a.role) - rank(b.role) || a.nick.localeCompare(b.nick)
    })
  )
</script>

<div class="flex h-full flex-col">
  <p class="text-muted-foreground p-3 text-xs font-medium tracking-wide uppercase">
    {$LL.occupants({ count: occupants.length })}
  </p>
  <ScrollArea class="flex-1">
    <ul class="flex flex-col px-2 pb-3">
      {#each occupants as occupant (occupant.nick)}
        <li class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
          <PresenceDot presence={occupant.presence} />
          <span class="truncate" class:font-medium={occupant.self}>
            {occupant.nick}
          </span>
          {#if occupant.role === 'moderator'}
            <span class="text-muted-foreground text-xs">{$LL.roleModerator()}</span>
          {:else if occupant.affiliation === 'admin' || occupant.affiliation === 'owner'}
            <span class="text-muted-foreground text-xs">{$LL.roleAdmin()}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </ScrollArea>
</div>
