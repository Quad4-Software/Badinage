<script lang="ts">
  import { MapPin, Mic, Paperclip, Plus, SendHorizontal, Smile, Square, X } from '@lucide/svelte'

  import type { Geoloc } from '$lib/core/xmpp/stanzas'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import type { ConversationKind } from '$lib/state/chats.svelte'
  import { cn } from '$lib/utils/cn'
  import { bareJid } from '$lib/utils/jid'
  import { toast } from '$lib/ui/primitives/sonner'
  import { Button } from '$lib/ui/primitives/button'

  import EmojiPicker from './emoji-picker.svelte'
  import AttachSheet from './composer/attach-sheet.svelte'
  import ComposerContext from './composer/context.svelte'
  import RecordingMeter from './recording-meter.svelte'
  import { createVoiceRecorder } from '../../voice.svelte'
  import { createFileSend } from './composer/files'
  import { sendGeoloc } from './composer/location'
  import { mentionCandidates as candidatesFor, mentionToken } from './composer/mentions'
  import { createRtt } from './composer/rtt'
  import { sendText } from './composer/send'
  import { createTyping } from './composer/typing'

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
  let attachOpen = $state(false)
  // XEP-0372: the @token under the cursor and its completion candidates
  let mentionQuery = $state<{ start: number; text: string } | null>(null)
  let mentionIndex = $state(0)
  let locating = $state(false)

  const account = $derived(accounts.active)
  const conversation = $derived(account ? app.chatsFor(account.jid).open(peerJid) : undefined)

  // chat states (XEP-0085) and real-time text (XEP-0301) sender state
  const typing = createTyping({
    account: () => account,
    conversation: () => conversation,
    kind: () => kind,
    peer: () => peerJid
  })
  const rtt = createRtt({
    account: () => account,
    conversation: () => conversation,
    kind: () => kind,
    peer: () => peerJid,
    body: () => body
  })

  // save the draft whenever the text changes
  $effect(() => {
    app.setDraft(peerJid, body)
  })

  $effect(() => {
    return app.registerComposerFocus(peerJid, () => inputEl?.focus())
  })

  // switching peers or unmounting ends any live rtt session politely.
  // peer is captured so the cancel goes to the peer the session was on
  $effect(() => {
    const peer = peerJid
    return () => {
      rtt.dispose(peer)
      mentionQuery = null
    }
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

  // track the @token under the cursor so the suggestion list stays live
  function trackMention() {
    if (kind !== 'muc' || !inputEl) {
      mentionQuery = null
      return
    }
    mentionQuery = mentionToken(body, inputEl.selectionStart ?? body.length)
  }

  const mentionCandidates = $derived(candidatesFor(conversation, mentionQuery))

  function completeMention(nick: string) {
    if (!mentionQuery || !inputEl) return
    const cursor = inputEl.selectionStart ?? body.length
    const next = `${body.slice(0, mentionQuery.start)}${nick} ${body.slice(cursor)}`
    const pos = mentionQuery.start + nick.length + 1
    body = next
    mentionQuery = null
    inputEl.focus()
    // restore the caret after svelte writes the bound value back
    requestAnimationFrame(() => inputEl?.setSelectionRange(pos, pos))
  }

  // XEP-0080: share our current position as a geoloc stanza with a geo
  // uri body fallback. The timer/encryption wiring is identical to a
  // normal send.
  function shareLocation() {
    const current = account
    if (!current || locating) return
    if (!navigator.geolocation) {
      toast.error($LL.locationFailed())
      return
    }
    locating = true
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locating = false
        const geoloc: Geoloc = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }
        void sendGeoloc(current, peerJid, kind, conversation, geoloc)
      },
      () => {
        locating = false
        toast.error($LL.locationFailed())
      },
      { timeout: 15_000, enableHighAccuracy: false }
    )
  }

  async function send() {
    const text = body.trim()
    if (!account || (!text && !voice.recording)) return
    typing.sent()
    const sent = await sendText({
      account,
      peerJid,
      kind,
      conversation,
      ctx: app.composerFor(peerJid),
      text
    })
    if (!sent) return
    body = ''
    app.setComposer(peerJid, {})
    // the message is out. Any in-flight rtt session ends with a cancel
    rtt.reset()
    mentionQuery = null
  }

  function onKeydown(event: KeyboardEvent) {
    if (mentionCandidates.length > 0 && mentionQuery) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        mentionIndex = (mentionIndex + delta + mentionCandidates.length) % mentionCandidates.length
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const nick = mentionCandidates[mentionIndex]
        if (nick) {
          event.preventDefault()
          completeMention(nick)
          return
        }
      }
      if (event.key === 'Escape') {
        mentionQuery = null
        event.stopPropagation()
        return
      }
    }
    if (event.key === 'Escape' && (composerCtx.replyTo || composerCtx.editing)) {
      event.preventDefault()
      // keep the global nav.closeConversation binding from firing too
      event.stopPropagation()
      app.setComposer(peerJid, {})
      return
    }
    if (event.key !== 'Enter') typing.notifyTyping()
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

  const files = createFileSend({ account: () => account, peer: () => peerJid, kind: () => kind })
  const { sendFile, onFiles, onPaste } = files

  // the accept filter lands on the shared input before the picker opens,
  // so the attach sheet can offer image and video specific pickers
  function attach(accept = '') {
    if (fileEl) fileEl.accept = accept
    fileEl?.click()
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
  <ComposerContext {peerJid} ctx={composerCtx} />

  <div
    class="flex items-end gap-1.5 p-[var(--density-composer-pad)] pb-[max(var(--density-composer-pad),env(safe-area-inset-bottom))]"
  >
    <input
      bind:this={fileEl}
      type="file"
      class="hidden"
      onchange={onFiles}
      aria-hidden="true"
      tabindex={-1}
    />
    <!-- mobile: one button opens the attach sheet. Desktop keeps the
         separate row buttons -->
    <Button
      variant="ghost"
      size="icon"
      class="max-md:size-10 md:hidden"
      onclick={() => (attachOpen = true)}
      aria-label={$LL.attachFile()}
      disabled={voice.recording}
    >
      <Plus class="size-5" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="hidden md:inline-flex"
      onclick={() => attach()}
      aria-label={$LL.attachFile()}
      disabled={voice.recording}
    >
      <Paperclip class="size-4" />
    </Button>
    <div class="relative min-w-0 flex-1">
      {#if mentionCandidates.length > 0}
        <div
          role="listbox"
          aria-label={$LL.mentionSuggestions()}
          class="bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-1 min-w-40 rounded-md border p-1 shadow-md"
        >
          {#each mentionCandidates as nick, i (nick)}
            <button
              type="button"
              role="option"
              aria-selected={i === mentionIndex}
              class={cn(
                'flex w-full cursor-pointer items-center rounded-sm px-2 py-1 text-left text-sm',
                i === mentionIndex ? 'bg-accent' : 'hover:bg-accent'
              )}
              onmousedown={(e) => {
                e.preventDefault()
                completeMention(nick)
              }}
            >
              {nick}
            </button>
          {/each}
        </div>
      {/if}
      <Button
        variant="ghost"
        size="icon"
        class="absolute bottom-1 left-1 size-8"
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
      <textarea
        bind:value={body}
        bind:this={inputEl}
        rows={1}
        onkeydown={onKeydown}
        oninput={() => {
          trackMention()
          rtt.maybeSend()
          mentionIndex = 0
        }}
        onpaste={onPaste}
        {placeholder}
        aria-label={placeholder}
        disabled={voice.recording}
        enterkeyhint={settings.current.sendWithEnter ? 'send' : 'enter'}
        autocapitalize="sentences"
        class="border-input selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none overflow-y-auto rounded-md border bg-transparent py-2 pr-3 pl-10 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
      ></textarea>
    </div>
    <Button
      variant="ghost"
      size="icon"
      class="hidden md:inline-flex"
      onclick={shareLocation}
      aria-label={$LL.shareLocation()}
      disabled={voice.recording || locating}
    >
      <MapPin class="size-4" />
    </Button>
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
        class="max-md:size-10"
        onclick={() => voice.cancel()}
        aria-label={$LL.cancelRecording()}
      >
        <X class="size-4" />
      </Button>
      <Button
        size="icon"
        class="max-md:size-10"
        onclick={toggleRecording}
        aria-label={$LL.stopRecording()}
      >
        <Square class="size-4" />
      </Button>
    {:else if body.trim()}
      <Button size="icon" class="max-md:size-10" onclick={send} aria-label={$LL.send()}>
        <SendHorizontal class="size-4" />
      </Button>
    {:else}
      <Button
        variant="ghost"
        size="icon"
        class="max-md:size-10"
        onclick={toggleRecording}
        aria-label={$LL.recordVoice()}
      >
        <Mic class="size-4" />
      </Button>
    {/if}
  </div>
</div>

<AttachSheet
  bind:open={attachOpen}
  {locating}
  onAttach={(accept) => attach(accept)}
  onLocation={shareLocation}
/>
