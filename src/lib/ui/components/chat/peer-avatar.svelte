<script lang="ts">
  import { accounts, type Account } from '$lib/state/accounts.svelte'
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/ui/primitives/avatar'

  interface Props {
    // avatar key: bare contact or room jid, room/nick occupant key, or
    // our own jid
    jid: string
    // which account resolves the avatar; defaults to the active one. The
    // account switcher passes each listed account explicitly.
    account?: Account | undefined
    // fetch even without a presence-advertised photo hash. Hint-gated
    // callers (roster rows, occupants) keep the default so rendering a
    // list never fans out into vcard queries.
    force?: boolean
    fallback: string
    class?: string
  }

  let { jid, account, force = false, fallback, class: className }: Props = $props()

  const owner = $derived(account ?? accounts.active)
  const src = $derived(owner?.avatars.get(jid))

  // ensureAvatar reads the reactive avatar stores, so this re-runs when a
  // new presence photo hash invalidates the cached image
  $effect(() => {
    if (jid) owner?.ensureAvatar(jid, force)
  })
</script>

<Avatar class={className}>
  {#if src}
    <AvatarImage {src} alt="" />
  {/if}
  <AvatarFallback>{fallback}</AvatarFallback>
</Avatar>
