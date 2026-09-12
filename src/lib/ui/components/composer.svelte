<script lang="ts">
  import { Mic, Paperclip, SendHorizontal, Smile, Square, X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import type { Attachment, ConversationKind } from '$lib/state/chats.svelte'
  import { bareJid } from '$lib/utils/jid'
  import { toast } from '$lib/ui/primitives/sonner'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'

  import EmojiPicker from './emoji-picker.svelte'

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
  let recording = $state(false)
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let composingSent = false
  let pauseTimer: ReturnType<typeof setTimeout> | undefined

  const account = $derived(accounts.active)

  // save the draft whenever the text changes
  $effect(() => {
    app.setDraft(peerJid, body)
  })

  $effect(() => {
    app.composerFocus = () => inputEl?.focus()
    return () => (app.composerFocus = undefined)
  })

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
    }, 4000)
  }

  function pushOutgoing(text: string, attachments?: Attachment[]) {
    if (!account) return
    app.chatsFor(account.jid).push(peerJid, {
      id: account.connection.uniqueId('local'),
      peerJid,
      body: text,
      outgoing: true,
      timestamp: Date.now(),
      encrypted: false,
      delivered: false,
      read: false,
      reactions: {},
      attachments,
      nick: kind === 'muc' ? (account.roster ? undefined : undefined) : undefined
    })
  }

  function send() {
    const text = body.trim()
    if (!account || (!text && !recording)) return
    clearTimeout(pauseTimer)
    composingSent = false

    const type = kind === 'muc' ? 'groupchat' : 'chat'
    const ctx = app.composer

    if (ctx.editing) {
      const ref = ctx.editing.wireId ?? ctx.editing.id
      account.connection.sendChatMessage(peerJid, text, type, { replaceId: ref })
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
      const id = account.connection.sendChatMessage(peerJid, text, type, {
        replyTo:
          replyTo && wireRef ? { id: wireRef, to: replyTo.outgoing ? peerJid : peerJid } : undefined
      })
      const store = app.chatsFor(account.jid)
      const conversation = store.open(peerJid)
      store.push(peerJid, {
        id,
        wireId: id,
        peerJid,
        body: text,
        outgoing: true,
        timestamp: Date.now(),
        encrypted: false,
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
    app.composer = {}
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && (app.composer.replyTo || app.composer.editing)) {
      app.composer = {}
      return
    }
    if (event.key !== 'Enter') notifyTyping()
    if (!settings.current.sendWithEnter) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
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

  async function sendFile(file: Blob, name: string, mediaType: string, duration?: number) {
    if (!account) return
    const conn = account.connection
    const type = kind === 'muc' ? 'groupchat' : 'chat'
    conn.requestUploadSlot(name, file.size, mediaType, async (slot) => {
      let url: string
      if (slot) {
        try {
          await conn.uploadFile(slot.putUrl, file)
          url = slot.getUrl
        } catch {
          toast.error($LL.uploadFailed())
          return
        }
      } else {
        // no upload service (or demo mode): embed small files as data URIs
        if (file.size > 512 * 1024) {
          toast.error($LL.uploadFailed())
          return
        }
        url = await blobToDataUri(file)
      }
      conn.sendAttachment(peerJid, url, type, {
        name,
        mediaType,
        size: file.size,
        duration
      })
      pushOutgoing(url, [{ url, mediaType, name, size: file.size, duration }])
    })
  }

  function blobToDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  }

  async function toggleRecording() {
    if (recording) {
      recorder?.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/webm'
      chunks = []
      recorder = new MediaRecorder(stream, { mimeType: mime })
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: mime.split(';')[0] ?? 'audio/ogg' })
        recording = false
        await sendFile(blob, `voice-${Date.now()}.ogg`, 'audio/ogg; codecs=opus')
      }
      recorder.start()
      recording = true
    } catch {
      recording = false
    }
  }

  function cancelRecording() {
    if (recorder) {
      recorder.onstop = null
      recorder.stop()
      recording = false
    }
  }
</script>

<div class="border-t">
  {#if app.composer.replyTo}
    <div class="bg-muted/60 flex items-center gap-2 px-3 py-1.5 text-xs">
      <span class="border-primary min-w-0 flex-1 truncate border-l-2 pl-2">
        {$LL.replyingTo({
          name: app.composer.replyTo.nick ?? bareJid(app.composer.replyTo.peerJid)
        })}:
        {app.composer.replyTo.body}
      </span>
      <Button
        variant="ghost"
        size="icon"
        class="size-6 shrink-0"
        onclick={() => (app.composer = {})}
        aria-label={$LL.cancelEdit()}
      >
        <X class="size-3.5" />
      </Button>
    </div>
  {:else if app.composer.editing}
    <div class="bg-muted/60 flex items-center gap-2 px-3 py-1.5 text-xs">
      <span class="border-primary min-w-0 flex-1 truncate border-l-2 pl-2">
        {$LL.editingMessage()}: {app.composer.editing.body}
      </span>
      <Button
        variant="ghost"
        size="icon"
        class="size-6 shrink-0"
        onclick={() => (app.composer = {})}
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
      disabled={recording}
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
        disabled={recording}
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
      disabled={recording}
    />
    {#if recording}
      <span class="text-destructive animate-pulse px-1 text-xs font-medium">REC</span>
      <Button
        variant="ghost"
        size="icon"
        onclick={cancelRecording}
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
