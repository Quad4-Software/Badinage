<script lang="ts">
  import { Star } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Bookmark } from '$lib/core/xmpp/connection'
  import type { MenuItem } from '$lib/state/app/menus.svelte'

  import { contextArea } from '../../context-menu/area'
  import PeerAvatar from '../peer-avatar.svelte'

  interface Props {
    bookmark: Bookmark
    onSelect: () => void
    menuItems?: () => MenuItem[]
  }

  let { bookmark, onSelect, menuItems }: Props = $props()

  const isRoom = $derived(bookmark.kind === 'conference')
  const name = $derived(bookmark.name || bookmark.jid.split('@')[0] || bookmark.jid)
</script>

<button
  class="hover:bg-accent flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left"
  title={bookmark.jid}
  onclick={onSelect}
  {@attach contextArea({
    section: 'sidebar.bookmark',
    payload: { jid: bookmark.jid, name },
    items: () => menuItems?.() ?? []
  })}
>
  <PeerAvatar jid={bookmark.jid} fallback={isRoom ? '#' : name.slice(0, 2)} force />
  <span class="min-w-0 flex-1">
    <span class="flex items-center gap-1.5 text-sm">
      <span class="truncate">{name}</span>
      {#if bookmark.autojoin}
        <Star
          class="text-muted-foreground size-3 shrink-0"
          aria-label={$LL.autojoin()}
          role="img"
        />
      {/if}
    </span>
    <span class="text-muted-foreground block truncate text-xs">{bookmark.jid}</span>
  </span>
</button>
