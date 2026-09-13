// Chat state (XEP-0085) bookkeeping for conversations. Chat states have
// no wire timeout: a peer that goes offline while composing would look
// like it types forever, so stale composing states expire on a timer.

import { CHAT_STATE_TTL_MS } from '$lib/constants'
import type { ChatState } from '$lib/core/xmpp/stanzas'

import type { Conversation } from './conversation.svelte'

export class TypingTracker {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  note(conversation: Conversation, sender: string, state: ChatState): void {
    if (conversation.kind === 'muc') {
      if (!sender) return
      if (state === 'composing') {
        conversation.typers.add(sender)
        this.arm(conversation, sender)
      } else {
        this.clear(conversation, sender)
      }
      return
    }
    // dms track a single peer state; arm an expiry only for composing
    if (state === 'composing') {
      this.arm(conversation, '')
    } else {
      this.clear(conversation, '')
    }
  }

  clear(conversation: Conversation, nick: string): void {
    const key = this.key(conversation, nick)
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    this.timers.delete(key)
    if (conversation.kind === 'muc') {
      conversation.typers.delete(nick)
    } else if (conversation.peerState === 'composing') {
      conversation.peerState = 'paused'
    }
  }

  private key(conversation: Conversation, nick: string): string {
    return `${conversation.peerJid}${nick}`
  }

  private arm(conversation: Conversation, nick: string): void {
    const key = this.key(conversation, nick)
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    this.timers.set(
      key,
      setTimeout(() => this.clear(conversation, nick), CHAT_STATE_TTL_MS)
    )
  }
}
