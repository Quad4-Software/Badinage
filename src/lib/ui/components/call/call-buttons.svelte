<script lang="ts">
  import { Phone, Video } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Account } from '$lib/state/accounts.svelte'
  import { calls } from '$lib/state/call/call.svelte'
  import type { Conversation } from '$lib/state/conversation.svelte'
  import { Button } from '$lib/ui/primitives/button'

  let { account, conversation }: { account?: Account | undefined; conversation: Conversation } =
    $props()

  // jingle calls target the peer's full jid. The probe caches whether
  // that resource advertises support so dead-end buttons never render
  const peer = $derived(account && calls.canCall(account) ? conversation.peerFullJid : undefined)
  $effect(() => {
    if (account && peer) calls.probe(account, peer)
  })
  const capable = $derived(peer !== undefined && calls.capable.get(peer) === true)
</script>

{#if capable && peer && account}
  <Button
    variant="ghost"
    size="icon"
    onclick={() => void calls.start(account, peer, false)}
    aria-label={$LL.callAudio()}
  >
    <Phone class="size-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon"
    onclick={() => void calls.start(account, peer, true)}
    aria-label={$LL.callVideo()}
  >
    <Video class="size-4" />
  </Button>
{/if}
