<script lang="ts">
  import { Mic, Paperclip, SendHorizontal, Smile, Square, X } from '@lucide/svelte'

  import { TYPING_NOTICE_MS } from '$lib/constants'
  import type { ChatState } from '$lib/core/xmpp/stanzas'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import type { ConversationKind } from '$lib/state/chats.svelte'
  import { sendFileMessage } from '$lib/state/upload'
  import { bareJid } from '$lib/utils/jid'
  import { parseSpoilerCommand } from '$lib/utils/message-commands'
  import { toast } from '$lib/ui/primitives/sonner'
  import { Button } from '$lib/ui/primitives/button'

  import EmojiPicker from './emoji-picker.svelte'
  import RecordingMeter from './recording-meter.svelte'
  import { createVoiceRecorder } from '../../voice.svelte'

  let {
    peerJid,
    kind = 'dm',
    peerName
  }: { peerJid: string; kind?: ConversationKind; peerName?: string | undefined } = $props()

  // writable derived: resets to the per-peer draft whenever peerJid changes,
  // user typing overrides it until then
  let body = $derived(app.getDraft(peerJid))
  let inputEl = $state<HTMLTextAreaElement | null>(null)
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

  // grow the textarea with its content, capped so it scrolls past the cap.
  // reading body tracks it, so draft restores, emoji inserts, and post-send
  // clears all resize too
  const MAX_COMPOSER_HEIGHT = 200
  $effect(() => {
    const el = inputEl
    if (!el) return
    if (el.value !== body) el.value = body
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  })

  const composerCtx = $derived(app.composerFor(peerJid))

  const placeholder = $derived($LL.messagePlaceholder({ peer: peerName || bareJid(peerJid) }))

  // XEP-0085 chat states. In an encrypted conversation the state rides
  // inside an SCE envelope (sent as a bare notification, no fallback
  // body) so typing metadata never leaks in the clear; peers without
  // usable omemo:2 devices get the plain cleartext state instead.
  function sendState(state: ChatState) {
    if (!account) return
    const conversation = app.chatsFor(account.jid).open(peerJid)
    if (conversation.encrypted !== true) {
      account.connection.sendChatState(peerJid, state)
      return
    }
    void Promise.resolve(account.omemo ?? account.omemoService())
      .then(async (omemo) => {
        if (!account) return
        const xml = omemo ? await omemo.encryptChatState(peerJid, state) : null
        if (xml !== null) account.connection.sendEncryptedNotification(peerJid, xml)
        else account.connection.sendChatState(peerJid, state)
      })
      .catch(() => account?.connection.sendChatState(peerJid, state))
  }

  // XEP-0085: emit composing when typing starts, paused after a short idle.
  // DMs only - chat states in MUC are noisy and many rooms discourage them.
  function notifyTyping() {
    if (!account || kind !== 'dm' || !settings.current.sendChatStates) return
    if (!composingSent) {
      composingSent = true
      sendState('composing')
    }
    clearTimeout(pauseTimer)
    pauseTimer = setTimeout(() => {
      if (composingSent) {
        composingSent = false
        sendState('paused')
      }
    }, TYPING_NOTICE_MS)
  }

  async function send() {
    const text = body.trim()
    if (!account || (!text && !voice.recording)) return
    clearTimeout(pauseTimer)
    composingSent = false

    const type = kind === 'muc' ? 'groupchat' : 'chat'
    const ctx = app.composerFor(peerJid)
    // XEP-0382 slash command: "/spoiler [hint] text" hides text behind a
    // spoiler with the bracketed hint, "/spoiler text" is hintless. A
    // plain "/me ..." stays literal on the wire; the render side splits it.
    const spoiler = parseSpoilerCommand(text)
    const sendText = spoiler?.body ?? text

    if (ctx.editing) {
      const ref = ctx.editing.wireId ?? ctx.editing.id
      let sent = false
      if (type === 'chat') {
        const omemo = account.omemo ?? (await account.omemoService())
        if (omemo) {
          try {
            // the correction rides inside the SCE envelope; the wire
            // stanza never carries a cleartext replace element
            const xml = await omemo.encryptBody(peerJid, sendText, {
              replaceId: ref,
              spoilerHint: spoiler?.hint
            })
            if (xml !== null) {
              account.connection.sendEncryptedMessage(peerJid, xml)
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
        account.connection.sendChatMessage(peerJid, sendText, type, {
          replaceId: ref,
          spoilerHint: spoiler?.hint
        })
      }
      app
        .chatsFor(account.jid)
        .applyCorrection(peerJid, ctx.editing.id, sendText, Date.now(), spoiler?.hint)
    } else {
      const replyTo = ctx.replyTo
      // XEP-0461: in MUC the referenced id is the room stanza-id (stored as
      // message.id), in DMs the wire id attribute
      const wireRef = replyTo
        ? kind === 'muc'
          ? replyTo.id
          : (replyTo.wireId ?? replyTo.id)
        : undefined
      // XEP-0461: the reply 'to' attribute names the author of the quoted
      // stanza - our own bare jid when we quote ourselves
      const replyRef =
        replyTo && wireRef
          ? { id: wireRef, to: replyTo.outgoing ? bareJid(account.jid) : peerJid }
          : undefined
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
            // error is a real failure and must not downgrade to plaintext.
            // The reply reference and spoiler marker travel inside the
            // envelope with the body.
            encryptedXml = await omemo.encryptBody(peerJid, sendText, {
              replyTo: replyRef,
              spoilerHint: spoiler?.hint
            })
          } catch {
            toast.error($LL.encryptFailed())
            return
          }
        }
      }
      const encrypted = encryptedXml !== null
      const id = encryptedXml
        ? account.connection.sendEncryptedMessage(peerJid, encryptedXml)
        : account.connection.sendChatMessage(peerJid, sendText, type, {
            replyTo: replyRef,
            spoilerHint: spoiler?.hint
          })
      const store = app.chatsFor(account.jid)
      const conversation = store.open(peerJid)
      // keep the flag honest: a peer that removed its device list drops
      // the conversation back to plaintext
      if (type === 'chat') conversation.encrypted = encrypted
      store.push(peerJid, {
        id,
        wireId: id,
        peerJid,
        body: sendText,
        outgoing: true,
        timestamp: Date.now(),
        encrypted,
        delivered: false,
        read: false,
        reactions: {},
        spoilerHint: spoiler?.hint,
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

  // pasted files ride the same upload path as picked ones; nameless
  // clipboard blobs get a generated name with an extension from the type
  function onPaste(event: ClipboardEvent) {
    const files = event.clipboardData?.files
    if (!files?.length) return
    event.preventDefault()
    for (const file of files) {
      const name = file.name || `pasted-${Date.now()}.${file.type.split('/')[1] ?? 'bin'}`
      sendFile(file, name, file.type || 'application/octet-stream')
    }
  }

  function sendFile(file: Blob, name: string, mediaType: string, duration?: number) {
    if (!account) return
    sendFileMessage(
      account,
      peerJid,
      kind === 'muc' ? 'groupchat' : 'chat',
      file,
      name,
      mediaType,
      () => toast.error($LL.uploadFailed()),
      duration
    )
  }

  // m:ss clock for the recording row
  function formatElapsed(ms: number): string {
    const total = Math.floor(ms / 1000)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
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

  <div class="flex items-end gap-1.5 p-[var(--density-composer-pad)]">
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
        <div class="absolute bottom-full left-0 z-50 mb-2">
          <EmojiPicker onPick={pickEmoji} onClose={() => (emojiOpen = false)} />
        </div>
      {/if}
    </div>
    <textarea
      bind:value={body}
      bind:this={inputEl}
      rows={1}
      onkeydown={onKeydown}
      onpaste={onPaste}
      {placeholder}
      aria-label={placeholder}
      disabled={voice.recording}
      class="border-input selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-w-0 flex-1 resize-none overflow-y-auto rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
    ></textarea>
    {#if voice.recording}
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <RecordingMeter analyser={voice.analyser} />
        <span class="text-destructive shrink-0 text-xs font-medium tabular-nums">
          {formatElapsed(voice.elapsedMs)}
        </span>
      </div>
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
