<script lang="ts">
  import { accounts } from '$lib/state/accounts.svelte'
  import { extApi } from '$lib/state/app/ext-api.svelte'
  import type { ChatMessage } from '$lib/state/chats.svelte'

  let { message }: { message: ChatMessage } = $props()

  const key = $derived(`${accounts.active?.jid ?? ''}|${message.peerJid}|${message.id}`)
  const deco = $derived(extApi.decorations.get(key))

  // resolved lazily on render: virtualization keeps the number of
  // worker calls bounded to the mounted rows
  $effect(() => {
    const accountJid = accounts.active?.jid
    if (!accountJid || message.pending === true || message.retracted === true) return
    void extApi.ensureDecoration(key, {
      id: message.id,
      peerJid: message.peerJid,
      nick: message.nick,
      outgoing: message.outgoing,
      timestamp: message.timestamp,
      body: message.body
    })
  })
</script>

{#if deco?.footer}
  <p
    class="text-muted-foreground mt-1 text-xs"
    class:text-right={message.outgoing}
    title={deco.title}
  >
    {deco.footer}
  </p>
{/if}
