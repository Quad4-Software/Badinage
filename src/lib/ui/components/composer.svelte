<script lang="ts">
  import { SendHorizontal } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import type { ConversationKind } from '$lib/state/chats.svelte'
  import { bareJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'

  let { peerJid, kind = 'dm' }: { peerJid: string; kind?: ConversationKind } = $props()

  let body = $state('')
  let inputEl = $state<HTMLInputElement | null>(null)
  let composingSent = false
  let pauseTimer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    app.composerFocus = () => inputEl?.focus()
    return () => (app.composerFocus = undefined)
  })

  // XEP-0085: emit composing when typing starts, paused after a short idle.
  // DMs only - chat states in MUC are noisy and many rooms discourage them.
  function notifyTyping() {
    const account = accounts.active
    if (!account || kind !== 'dm') return
    if (!composingSent) {
      composingSent = true
      account.connection.sendChatState(peerJid, 'composing')
    }
    clearTimeout(pauseTimer)
    pauseTimer = setTimeout(() => {
      if (composingSent) {
        composingSent = false
        account.connection.sendChatState(peerJid, 'paused')
      }
    }, 4000)
  }

  function send() {
    const account = accounts.active
    const text = body.trim()
    if (!account || !text) return
    clearTimeout(pauseTimer)
    composingSent = false
    const type = kind === 'muc' ? 'groupchat' : 'chat'
    const id = account.connection.sendChatMessage(peerJid, text, type)
    app.chatsFor(account.jid).push(peerJid, {
      id,
      wireId: id,
      peerJid,
      body: text,
      outgoing: true,
      timestamp: Date.now(),
      encrypted: false,
      delivered: false,
      read: false,
      nick:
        kind === 'muc'
          ? (app.chatsFor(account.jid).conversations.get(peerJid)?.ourNick ?? undefined)
          : undefined
    })
    body = ''
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') notifyTyping()
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
