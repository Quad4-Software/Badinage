<script lang="ts">
  import { SendHorizontal } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { bareJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'

  let { peerJid }: { peerJid: string } = $props()

  let body = $state('')
  let inputEl = $state<HTMLInputElement | null>(null)

  $effect(() => {
    app.composerFocus = () => inputEl?.focus()
    return () => (app.composerFocus = undefined)
  })

  function send() {
    const account = accounts.active
    const text = body.trim()
    if (!account || !text) return
    const id = account.connection.sendChatMessage(peerJid, text)
    app.chatsFor(account.jid).push(peerJid, {
      id,
      peerJid,
      body: text,
      outgoing: true,
      timestamp: Date.now(),
      encrypted: false
    })
    body = ''
  }

  function onKeydown(event: KeyboardEvent) {
    if (!settings.current.sendWithEnter) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }
</script>

<div class="flex items-center gap-2 border-t p-3">
  <Input
    bind:value={body}
    bind:ref={inputEl}
    onkeydown={onKeydown}
    placeholder={$LL.messagePlaceholder({ peer: bareJid(peerJid) })}
    aria-label={$LL.messagePlaceholder({ peer: bareJid(peerJid) })}
    class="flex-1"
  />
  <Button size="icon" onclick={send} disabled={!body.trim()} aria-label={$LL.send()}>
    <SendHorizontal class="size-4" />
  </Button>
</div>
