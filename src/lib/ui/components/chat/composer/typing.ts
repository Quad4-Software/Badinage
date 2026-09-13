// XEP-0085 chat-state sending for the composer: composing on first
// keystroke, paused after a short idle. Extracted for the size gate.

import { TYPING_NOTICE_MS } from '$lib/constants'
import type { ChatState } from '$lib/core/xmpp/stanzas'
import type { Account } from '$lib/state/accounts.svelte'
import type { Conversation, ConversationKind } from '$lib/state/chats.svelte'
import { settings } from '$lib/state/settings.svelte'

export interface TypingDeps {
  account: () => Account | undefined
  conversation: () => Conversation | undefined
  kind: () => ConversationKind
  peer: () => string
}

export function createTyping(deps: TypingDeps): { notifyTyping: () => void; sent: () => void } {
  let composingSent = false
  let pauseTimer: ReturnType<typeof setTimeout> | undefined

  // In an encrypted conversation the state rides inside an SCE envelope
  // (sent as a bare notification, no fallback body) so typing metadata
  // never leaks in the clear. Peers without usable omemo:2 devices get
  // the plain cleartext state instead.
  function sendState(state: ChatState): void {
    const account = deps.account()
    if (!account) return
    const peer = deps.peer()
    if (deps.conversation()?.encrypted !== true) {
      account.connection.sendChatState(peer, state)
      return
    }
    void Promise.resolve(account.omemo ?? account.omemoService())
      .then(async (omemo) => {
        if (!account) return
        const xml = omemo ? await omemo.encryptChatState(peer, state) : null
        if (xml !== null) account.connection.sendEncryptedNotification(peer, xml)
        else account.connection.sendChatState(peer, state)
      })
      .catch(() => account?.connection.sendChatState(peer, state))
  }

  // emit composing when typing starts, paused after a short idle.
  // DMs only - chat states in MUC are noisy and many rooms discourage them.
  function notifyTyping(): void {
    const account = deps.account()
    if (!account || deps.kind() !== 'dm' || !settings.current.sendChatStates) return
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

  function sent(): void {
    clearTimeout(pauseTimer)
    composingSent = false
  }

  return { notifyTyping, sent }
}
