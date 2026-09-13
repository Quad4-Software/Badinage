<script lang="ts">
  import { Mic, Paperclip, SendHorizontal, Smile, Square, X } from '@lucide/svelte'

  import { TYPING_NOTICE_MS } from '$lib/constants'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import type { Attachment, ConversationKind } from '$lib/state/chats.svelte'
  import { uploadAndSend } from '$lib/state/upload'
  import { bareJid } from '$lib/utils/jid'
  import { toast } from '$lib/ui/primitives/sonner'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'

  import EmojiPicker from './emoji-picker.svelte'
  import { createVoiceRecorder } from '../../voice.svelte'

  let {
    peerJid,
    kind = 'dm',
    peerName
  }: { peerJid: string; kind?: ConversationKind; peerName?: string | undefined } = $props()

  // writable derived: resets to the per-peer draft whenever peerJid changes,
  // user typing overrides it until then
  let body = $derived(app.getDraft(peerJid))
  let inputEl = $state<HTMLInputElement | null>(null)
  let fileEl = $state<HTMLInputElement | null>(null)
  let emojiOpen = $state(false)
  let composingSent = false
  let pauseTimer: ReturnType<typeof setTimeout> | undefined

  const account = $derived(accounts.active)

  // save the draft whenever the text changes
  $effect(() => {
    app.setDraft(peerJid, body)
  })

  $effect(() => {
    return app.registerComposerFocus(peerJid, () => inputEl?.focus())
  })

  const composerCtx = $derived(app.composerFor(peerJid))

  const placeholder = $derived($LL.messagePlaceholder({ peer: peerName || bareJid(peerJid) }))

  // XEP-0085: emit composing when typing starts, paused after a short idle.
  // DMs only - chat states in MUC are noisy and many rooms discourage them.
  function notifyTyping() {
    if (!account || kind !== 'dm' || !settings.current.sendChatStates) return
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
    }, TYPING_NOTICE_MS)
  }

  function pushOutgoing(text: string, attachments?: Attachment[], id?: string) {
    if (!account) return
    const store = app.chatsFor(account.jid)
    const msgId = id ?? account.connection.uniqueId('local')
    store.push(peerJid, {
      id: msgId,
      wireId: id,
      peerJid,
      body: text,
      outgoing: true,
      timestamp: Date.now(),
      encrypted: false,
      delivered: false,
      read: false,
      reactions: {},
      attachments,
      nick: kind === 'muc' ? store.open(peerJid).ourNick : undefined
    })
  }

  async function send() {
    const text = body.trim()
    if (!account || (!text && !voice.recording)) return
    clearTimeout(pauseTimer)
    composingSent = false

    const type = kind === 'muc' ? 'groupchat' : 'chat'
    const ctx = app.composerFor(peerJid)

    if (ctx.editing) {
      const ref = ctx.editing.wireId ?? ctx.editing.id
      let sent = false
      if (type === 'chat') {
        const omemo = account.omemo ?? (await account.omemoService())
        if (omemo) {
          try {
            const xml = await omemo.encryptBody(peerJid, text, { replaceId: ref })
            if (xml !== null) {
              account.connection.sendEncryptedMessage(peerJid, xml, { replaceId: ref })
              sent = true
            }
          } catch {
            // never downgrade a correction to plaintext on encrypt failure
            toast.error($LL.encryptFailed())
            return
          }
        }
      }
      if (!sent) {
        account.connection.sendChatMessage(peerJid, text, type, { replaceId: ref })
      }
      app.chatsFor(account.jid).applyCorrection(peerJid, ctx.editing.id, text, Date.now())
    } else {
      const replyTo = ctx.replyTo
      // XEP-0461: in MUC the referenced id is the room stanza-id (stored as
      // message.id), in DMs the wire id attribute
      const wireRef = replyTo
        ? kind === 'muc'
          ? replyTo.id
          : (replyTo.wireId ?? replyTo.id)
        : undefined
      const replyRef =
        replyTo && wireRef ? { id: wireRef, to: replyTo.outgoing ? peerJid : peerJid } : undefined
      // encrypt when the peer publishes omemo devices; falls back to
      // plaintext when there are none or every device is distrusted
      let encryptedXml: string | null = null
      if (type === 'chat') {
        // await the in-flight service creation so a message sent right
        // after connect is still encrypted
        const omemo = account.omemo ?? (await account.omemoService())
        if (omemo) {
          try {
            // null means the peer publishes no usable devices; a thrown
            // error is a real failure and must not downgrade to plaintext
            encryptedXml = await omemo.encryptBody(peerJid, text)
          } catch {
            toast.error($LL.encryptFailed())
            return
          }
        }
      }
      const encrypted = encryptedXml !== null
      const id = encryptedXml
        ? account.connection.sendEncryptedMessage(peerJid, encryptedXml, { replyTo: replyRef })
        : account.connection.sendChatMessage(peerJid, text, type, { replyTo: replyRef })
      const store = app.chatsFor(account.jid)
      const conversation = store.open(peerJid)
      if (encrypted) conversation.encrypted = true
      store.push(peerJid, {
        id,
        wireId: id,
        peerJid,
        body: text,
        outgoing: true,
        timestamp: Date.now(),
        encrypted,
        delivered: false,
        read: false,
        reactions: {},
        replyTo: replyTo
          ? {
              id: replyTo.id,
              from: replyTo.outgoing
                ? (conversation.ourNick ?? account.jid)
                : (replyTo.nick ?? peerJid),
              quote: replyTo.body
            }
          : undefined,
        nick: kind === 'muc' ? (conversation.ourNick ?? undefined) : undefined
      })
    }
    body = ''
    app.setComposer(peerJid, {})
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && (composerCtx.replyTo || composerCtx.editing)) {
      event.preventDefault()
      // keep the global nav.closeConversation binding from firing too
      event.stopPropagation()
      app.setComposer(peerJid, {})
      return
    }
    if (event.key !== 'Enter') notifyTyping()
    if (!settings.current.sendWithEnter) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  function pickEmoji(emoji: string) {
    body += emoji
    emojiOpen = false
    inputEl?.focus()
  }

  function attach() {
    fileEl?.click()
  }

  async function onFiles(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || !account) return
    await sendFile(file, file.name, file.type || 'application/octet-stream')
  }

  function sendFile(file: Blob, name: string, mediaType: string, duration?: number) {
    if (!account) return
    uploadAndSend(
      account,
      peerJid,
      kind === 'muc' ? 'groupchat' : 'chat',
      file,
      name,
      mediaType,
      duration,
      (url, attachment, id) => pushOutgoing(url, [attachment], id),
      () => toast.error($LL.uploadFailed())
    )
  }

  const voice = createVoiceRecorder((blob, mime) => {
    const webm = mime.startsWith('audio/webm')
    void sendFile(
      blob,
      `voice-${Date.now()}.${webm ? 'webm' : 'ogg'}`,
      webm ? 'audio/webm' : 'audio/ogg; codecs=opus'
    )
  })

  function toggleRecording() {
    if (voice.recording) voice.stop()
    else void voice.start()
  }
</script>

<div class="border-t">
  {#if composerCtx.replyTo}
    <div class="bg-muted/60 flex items-center gap-2 px-3 py-1.5 text-xs">
      <span class="border-primary min-w-0 flex-1 truncate border-l-2 pl-2">
        {$LL.replyingTo({
          name: composerCtx.replyTo.nick ?? bareJid(composerCtx.replyTo.peerJid)
        })}:
        {composerCtx.replyTo.body}
      </span>
      <Button
        variant="ghost"
        size="icon"
        class="size-6 shrink-0"
        onclick={() => app.setComposer(peerJid, {})}
        aria-label={$LL.cancelEdit()}
      >
        <X class="size-3.5" />
      </Button>
    </div>
  {:else if composerCtx.editing}
    <div class="bg-muted/60 flex items-center gap-2 px-3 py-1.5 text-xs">
      <span class="border-primary min-w-0 flex-1 truncate border-l-2 pl-2">
        {$LL.editingMessage()}: {composerCtx.editing.body}
      </span>
      <Button
        variant="ghost"
        size="icon"
        class="size-6 shrink-0"
        onclick={() => app.setComposer(peerJid, {})}
        aria-label={$LL.cancelEdit()}
      >
        <X class="size-3.5" />
      </Button>
    </div>
  {/if}

  <div class="flex items-center gap-1.5 p-3">
    <input
      bind:this={fileEl}
      type="file"
      class="hidden"
      onchange={onFiles}
      aria-hidden="true"
      tabindex={-1}
    />
    <Button
      variant="ghost"
      size="icon"
      onclick={attach}
      aria-label={$LL.attachFile()}
      disabled={voice.recording}
    >
      <Paperclip class="size-4" />
    </Button>
    <div class="relative">
      <Button
        variant="ghost"
        size="icon"
        onclick={() => (emojiOpen = !emojiOpen)}
        aria-label={$LL.addReactionEmoji()}
        aria-expanded={emojiOpen}
        disabled={voice.recording}
      >
        <Smile class="size-4" />
      </Button>
      {#if emojiOpen}
        <EmojiPicker onPick={pickEmoji} onClose={() => (emojiOpen = false)} />
      {/if}
    </div>
    <Input
      bind:value={body}
      bind:ref={inputEl}
      onkeydown={onKeydown}
      {placeholder}
      aria-label={placeholder}
      class="min-w-0 flex-1"
      disabled={voice.recording}
    />
    {#if voice.recording}
      <span class="text-destructive animate-pulse px-1 text-xs font-medium" role="status">
        {$LL.recording()}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onclick={() => voice.cancel()}
        aria-label={$LL.cancelRecording()}
      >
        <X class="size-4" />
      </Button>
      <Button size="icon" onclick={toggleRecording} aria-label={$LL.stopRecording()}>
        <Square class="size-4" />
      </Button>
    {:else if body.trim()}
      <Button size="icon" onclick={send} aria-label={$LL.send()}>
        <SendHorizontal class="size-4" />
      </Button>
    {:else}
      <Button variant="ghost" size="icon" onclick={toggleRecording} aria-label={$LL.recordVoice()}>
        <Mic class="size-4" />
      </Button>
    {/if}
  </div>
</div>
