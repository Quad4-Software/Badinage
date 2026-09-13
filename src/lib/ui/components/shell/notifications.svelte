<script lang="ts">
  // Renderless watcher: turns live incoming messages into desktop
  // notifications. Permission is asked lazily and always tied to intent:
  // when the user flips the setting on (general section) or on the first
  // message that would have notified while the browser is undecided.
  import LL from '$lib/i18n/i18n-svelte'
  import { NOTIFICATION_COALESCE_MS } from '$lib/constants'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app, type LiveMessage } from '$lib/state/app.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import {
    notifyPermission,
    playBeep,
    requestNotifyPermission,
    showNotification
  } from '$lib/ui/notify'
  import { bareJid } from '$lib/utils/jid'
  import { mediaKind } from '$lib/utils/media'
  import { chatNotifyMode, coalesced, shouldNotify, snippet } from '$lib/utils/notify'

  // last fire time per account:peer so rapid bursts collapse into one
  const lastFired: Record<string, number> = {}

  // encrypted conversations never leak plaintext into the OS notification
  function bodyFor(event: LiveMessage): string {
    if (event.encrypted) return $LL.encryptedMessage()
    if (event.body) return snippet(event.body)
    const attachment = event.attachment
    if (!attachment) return ''
    switch (mediaKind(attachment.url, attachment.mediaType)) {
      case 'image':
        return $LL.imageAttachment()
      case 'video':
        return $LL.videoAttachment()
      case 'audio':
        return $LL.voiceMessage()
      default:
        return attachment.name ?? $LL.fileAttachment()
    }
  }

  function fire(event: LiveMessage) {
    const active =
      event.accountJid === accounts.active?.jid && app.activePeer === bareJid(event.peer)
    const conversation = app.chatsFor(event.accountJid).conversations.get(bareJid(event.peer))
    const chatMode = chatNotifyMode(conversation?.notify, conversation?.kind ?? 'dm')
    const gate = {
      enabled: settings.current.notifications,
      accountEnabled: settings.metaFor(event.accountJid).notify !== false,
      permission: notifyPermission(),
      hidden: document.hidden,
      conversationActive: active,
      chatMode,
      mentioned: event.mentioned === true,
      attention: event.attention === true && settings.current.allowAttention
    }
    if (gate.enabled && gate.accountEnabled && gate.permission === 'default') {
      // still undecided: ask now, and if the user grants, this message
      // notifies right away
      void requestNotifyPermission().then((result) => {
        if (result === 'granted') fire(event)
      })
      return
    }
    // attention gets its sound even when the notification itself is
    // gated away (focused conversation); that is the point of a buzz
    if (event.attention && settings.current.allowAttention && settings.current.sounds) {
      playBeep()
    }
    if (!shouldNotify(gate)) return
    const tag = `badinage:${event.accountJid}:${bareJid(event.peer)}`
    const now = Date.now()
    if (!coalesced(lastFired[tag], now, NOTIFICATION_COALESCE_MS)) return
    lastFired[tag] = now
    const body = event.attention ? $LL.wantsAttention({ name: event.sender }) : bodyFor(event)
    showNotification(event.sender, body, tag, () => {
      accounts.activeJid = event.accountJid
      app.selectPeer(event.peer)
    })
    if (settings.current.sounds && !event.attention) playBeep()
  }

  $effect(() => app.onLiveMessage(fire))
</script>
