import { bareJid } from '$lib/utils/jid'

import { accounts } from './accounts.svelte'
import { ChatStore } from './chats.svelte'

class AppStore {
  chats = new Map<string, ChatStore>()
  activePeer = $state<string | null>(null)
  sidebarOpen = $state(false)
  settingsOpen = $state(false)
  loginOpen = $state(false)
  composerFocus: (() => void) | undefined

  private handlers = new Map<string, () => void>()

  chatsFor(accountJid: string): ChatStore {
    let store = this.chats.get(accountJid)
    if (!store) {
      store = new ChatStore(accountJid)
      this.chats.set(accountJid, store)
      this.bindMessages(accountJid, store)
    }
    return store
  }

  registerAction(id: string, handler: () => void): () => void {
    this.handlers.set(id, handler)
    return () => this.handlers.delete(id)
  }

  dispatch(id: string): void {
    this.handlers.get(id)?.()
  }

  conversationList(accountJid: string): string[] {
    return [...this.chatsFor(accountJid).conversations.keys()]
  }

  cycleConversation(direction: 1 | -1): void {
    const account = accounts.active
    if (!account) return
    const peers = this.conversationList(account.jid)
    if (peers.length === 0) return
    const current = this.activePeer ? peers.indexOf(bareJid(this.activePeer)) : -1
    const next = (current + direction + peers.length) % peers.length
    this.activePeer = peers[next] ?? null
  }

  private bindMessages(accountJid: string, store: ChatStore): void {
    const account = accounts.list.find((a) => a.jid === accountJid)
    if (!account) return
    account.connection.events.on('message', (message) => {
      store.push(message.from, {
        id: message.stanzaId ?? crypto.randomUUID(),
        peerJid: message.from,
        body: message.body,
        outgoing: false,
        timestamp: message.delay ?? Date.now(),
        encrypted: false
      })
    })
  }
}

export const app = new AppStore()
