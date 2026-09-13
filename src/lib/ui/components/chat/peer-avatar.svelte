<script lang="ts">
  import { accounts, type Account } from '$lib/state/accounts.svelte'
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/ui/primitives/avatar'
  import { consistentColor, consistentInk } from '$lib/utils/protocol/color'

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
  // XEP-0392: the same jid hashes to the same color in every client that
  // implements the XEP, so a fallback initial block is stable everywhere.
  // The tile keeps the raw color as a 16 percent tint while the initials
  // take the same hue at a per-theme lightness that clears wcag aa
  const fallbackColor = $derived(consistentColor(jid))
  const ink = $derived(consistentInk(jid))

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
  <AvatarFallback
    class="peer-ink peer-tint"
    style="--peer-ink-light: {ink.light}; --peer-ink-dark: {ink.dark}; --peer-tint: {fallbackColor}"
  >
    {fallback}
  </AvatarFallback>
</Avatar>
