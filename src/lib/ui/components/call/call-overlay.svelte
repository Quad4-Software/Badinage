<script lang="ts">
  import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { calls } from '$lib/state/call/call.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import { bareJid } from '$lib/utils/jid'

  import PeerAvatar from '../chat/peer-avatar.svelte'

  const view = $derived(calls.view)
  const account = $derived(accounts.list.find((a) => a.jid === view?.accountJid))
  const peerBare = $derived(view ? bareJid(view.peer) : '')
  const peerName = $derived(
    account?.roster.find((c) => c.jid === peerBare)?.name || peerBare || view?.peer || ''
  )

  let remoteEl: HTMLMediaElement | undefined = $state()
  let localEl: HTMLVideoElement | undefined = $state()

  $effect(() => {
    if (remoteEl) remoteEl.srcObject = calls.remoteStream
  })
  $effect(() => {
    if (localEl) localEl.srcObject = calls.localStream
  })

  const statusLabel = $derived.by(() => {
    if (!view) return ''
    switch (view.phase) {
      case 'dialing':
        return $LL.callDialing()
      case 'ringing':
        return $LL.callRinging()
      case 'connecting':
        return $LL.callConnecting()
      case 'ended':
        return $LL.callEnded()
      default:
        return ''
    }
  })

  const reasonLabel = $derived.by(() => {
    switch (view?.endReason) {
      case 'busy':
        return $LL.callBusy()
      case 'decline':
        return $LL.callDeclined()
      case 'timeout':
        return $LL.callNoAnswer()
      case 'media-error':
        return $LL.callMediaError()
      case undefined:
      case 'success':
        return ''
      default:
        return $LL.callFailed()
    }
  })

  const showMedia = $derived(
    view !== null && (view.phase === 'connecting' || view.phase === 'active')
  )
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape' || !view) return
    if (view.phase === 'incoming') calls.decline()
    else if (view.phase !== 'ended') calls.hangup()
  }}
/>

{#if view}
  <div
    class="bg-background/95 fixed inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label={view.phase === 'incoming' ? $LL.callIncoming() : $LL.callAudio()}
  >
    <div class="relative flex h-full w-full flex-col items-center justify-center">
      {#if showMedia && view.video}
        <video
          bind:this={remoteEl as HTMLVideoElement}
          class="absolute inset-0 h-full w-full object-contain"
          autoplay
          playsinline
        ></video>
        <video
          bind:this={localEl}
          class="border-border absolute right-4 bottom-24 w-32 rounded-lg border object-cover shadow-lg"
          autoplay
          playsinline
          muted
        ></video>
      {:else}
        <PeerAvatar jid={peerBare} {account} fallback={peerName.slice(0, 2)} class="size-20" />
        <p class="mt-4 text-lg font-medium">{peerName}</p>
        {#if view.phase === 'incoming'}
          <p class="text-muted-foreground mt-1 text-sm">{$LL.callIncoming()}</p>
        {:else if statusLabel || reasonLabel}
          <p class="text-muted-foreground mt-1 text-sm" aria-live="polite">
            {reasonLabel || statusLabel}
          </p>
        {/if}
        {#if showMedia}
          <audio bind:this={remoteEl as HTMLAudioElement} autoplay></audio>
        {/if}
      {/if}

      {#if view.phase === 'incoming'}
        <div class="absolute bottom-16 flex items-center gap-6">
          <Button
            variant="destructive"
            size="icon"
            class="size-14 rounded-full"
            onclick={() => calls.decline()}
            aria-label={$LL.callDecline()}
          >
            <PhoneOff class="size-6" />
          </Button>
          <Button
            size="icon"
            class="size-14 rounded-full bg-green-600 hover:bg-green-700"
            onclick={() => void calls.accept()}
            aria-label={$LL.callAccept()}
          >
            <Phone class="size-6" />
          </Button>
        </div>
      {:else if view.phase === 'ended'}
        {#if reasonLabel}
          <p class="text-muted-foreground absolute bottom-16 text-sm">{reasonLabel}</p>
        {/if}
      {:else}
        <div class="absolute bottom-16 flex items-center gap-4">
          <Button
            variant="secondary"
            size="icon"
            class="size-12 rounded-full"
            onclick={() => calls.toggleMute()}
            aria-label={view.muted ? $LL.callUnmute() : $LL.callMute()}
            aria-pressed={view.muted}
          >
            {#if view.muted}
              <MicOff class="size-5" />
            {:else}
              <Mic class="size-5" />
            {/if}
          </Button>
          <Button
            variant="destructive"
            size="icon"
            class="size-14 rounded-full"
            onclick={() => calls.hangup()}
            aria-label={$LL.callHangUp()}
          >
            <PhoneOff class="size-6" />
          </Button>
          {#if view.video}
            <Button
              variant="secondary"
              size="icon"
              class="size-12 rounded-full"
              onclick={() => calls.toggleCamera()}
              aria-label={view.cameraOn ? $LL.callCameraOff() : $LL.callCameraOn()}
              aria-pressed={!view.cameraOn}
            >
              {#if view.cameraOn}
                <Video class="size-5" />
              {:else}
                <VideoOff class="size-5" />
              {/if}
            </Button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
