<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import type { RosterContact } from '$lib/state/accounts.svelte'
  import { Avatar, AvatarFallback } from '$lib/ui/primitives/avatar'
  import { presenceLabel } from '$lib/ui/presence'

  import PresenceDot from '../../presence/presence-dot.svelte'

  interface Props {
    contact: RosterContact
    blocked?: boolean
    onSelect: () => void
  }

  let { contact, blocked = false, onSelect }: Props = $props()

  const name = $derived(contact.name || contact.jid)
  const initials = $derived(name.slice(0, 2))
</script>

<button
  class="hover:bg-accent flex min-w-0 items-center gap-3 rounded-md px-2 py-[var(--density-row-pad)] text-left"
  title={contact.jid}
  onclick={onSelect}
>
  <span class="relative shrink-0">
    <Avatar>
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
    <PresenceDot
      presence={contact.presence}
      class="ring-background absolute -right-0.5 -bottom-0.5 ring-2"
    />
  </span>
  <span class="min-w-0 flex-1">
    <span class="density-text-sm block truncate">
      {name}
      {#if blocked}
        <span class="text-muted-foreground density-text-xs">· {$LL.blockedBadge()}</span>
      {/if}
    </span>
    <span class="text-muted-foreground density-text-xs block truncate">
      {contact.presenceStatus || presenceLabel(contact.presence)}
    </span>
  </span>
</button>
