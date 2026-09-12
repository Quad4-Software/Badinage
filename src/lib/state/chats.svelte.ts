import { SvelteMap } from 'svelte/reactivity'

import { bareJid } from '$lib/utils/jid'

export interface ChatMessage {
  id: string
  peerJid: string
  body: string
  outgoing: boolean
  timestamp: number
  encrypted: boolean
}

export interface Conversation {
  peerJid: string
  messages: ChatMessage[]
  unread: number
}

export class ChatStore {
  conversations = new SvelteMap<string, Conversation>()

  open(peerJid: string): Conversation {
    const bare = bareJid(peerJid)
    let conversation = this.conversations.get(bare)
    if (!conversation) {
      conversation = { peerJid: bare, messages: [], unread: 0 }
      this.conversations.set(bare, conversation)
    }
    conversation.unread = 0
    return conversation
  }

  push(peerJid: string, message: ChatMessage, active = false): void {
    const bare = bareJid(peerJid)
    const conversation = this.open(bare)
    conversation.messages.push(message)
    if (!message.outgoing && !active) conversation.unread += 1
  }
}
