import { SvelteMap } from 'svelte/reactivity'

import { MESSAGE_PAGE_SIZE } from '$lib/constants'
import { idb } from '$lib/core/storage/idb'
import { scopedKey } from '$lib/core/storage/keys'
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

const RETAINED_MESSAGES = MESSAGE_PAGE_SIZE * 4

export class ChatStore {
  conversations = new SvelteMap<string, Conversation>()
  private loaded: Record<string, true> = {}

  constructor(private readonly accountJid: string) {}

  open(peerJid: string): Conversation {
    const bare = bareJid(peerJid)
    let conversation = this.conversations.get(bare)
    if (!conversation) {
      conversation = { peerJid: bare, messages: [], unread: 0 }
      this.conversations.set(bare, conversation)
    }
    conversation.unread = 0
    if (!this.loaded[bare]) {
      this.loaded[bare] = true
      void this.hydrate(conversation)
    }
    return conversation
  }

  push(peerJid: string, message: ChatMessage, active = false): void {
    const bare = bareJid(peerJid)
    const conversation = this.open(bare)
    conversation.messages.push(message)
    if (!message.outgoing && !active) conversation.unread += 1
    void this.persist(conversation)
  }

  private storageKey(peerJid: string): string {
    return scopedKey(this.accountJid, 'msgs', bareJid(peerJid))
  }

  private async hydrate(conversation: Conversation): Promise<void> {
    const stored = await idb.get<ChatMessage[]>('messages', this.storageKey(conversation.peerJid))
    if (!stored || conversation.messages.length > 0) return
    conversation.messages.push(...stored)
  }

  private async persist(conversation: Conversation): Promise<void> {
    const retained = conversation.messages.slice(-RETAINED_MESSAGES)
    await idb.set('messages', this.storageKey(conversation.peerJid), retained)
  }
}
