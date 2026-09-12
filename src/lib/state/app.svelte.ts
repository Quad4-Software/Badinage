import { accounts } from './accounts.svelte'
import { ChatStore } from './chats.svelte'

class AppStore {
  chats = new Map<string, ChatStore>()
  activePeer = $state<string | null>(null)
  sidebarOpen = $state(false)

  chatsFor(accountJid: string): ChatStore {
    let store = this.chats.get(accountJid)
    if (!store) {
      store = new ChatStore()
      this.chats.set(accountJid, store)
      this.bindMessages(accountJid, store)
    }
    return store
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
