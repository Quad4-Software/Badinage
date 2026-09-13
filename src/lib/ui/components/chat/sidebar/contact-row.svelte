<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import type { RosterContact } from '$lib/state/accounts.svelte'
  import { cn } from '$lib/utils/cn'
  import { presenceClass, presenceLabel } from '$lib/ui/presence'

  import PeerAvatar from '../peer-avatar.svelte'

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
  <PeerAvatar jid={contact.jid} fallback={initials} />
  <span class="min-w-0 flex-1">
    <span class="density-text-sm block truncate">
      {name}
      {#if blocked}
        <span class="text-muted-foreground density-text-xs">· {$LL.blockedBadge()}</span>
      {/if}
    </span>
    <span
      class={cn(
        'density-text-xs block truncate',
        contact.presenceStatus ? 'text-muted-foreground' : presenceClass(contact.presence)
      )}
    >
      {contact.presenceStatus || presenceLabel(contact.presence)}
    </span>
  </span>
</button>
