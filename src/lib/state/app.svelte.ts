import { bareJid } from '$lib/utils/jid'

import { accounts } from './accounts.svelte'
import { ChatStore } from './chats.svelte'

class AppStore {
  chats = new Map<string, ChatStore>()
  activePeer = $state<string | null>(null)
  sidebarOpen = $state(false)
  settingsOpen = $state(false)
  loginOpen = $state(false)
  joinRoomOpen = $state(false)
  addContactOpen = $state(false)
  composerFocus: (() => void) | undefined

  private handlers = new Map<string, () => void>()
  private bound = new Set<string>()

  chatsFor(accountJid: string): ChatStore {
    let store = this.chats.get(accountJid)
    if (!store) {
      store = new ChatStore(accountJid)
      this.chats.set(accountJid, store)
    }
    this.bindAccount(accountJid)
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

  selectPeer(peer: string | null): void {
    this.activePeer = peer ? bareJid(peer) : null
    if (!peer) return
    const account = accounts.active
    if (!account) return
    const store = this.chatsFor(account.jid)
    const conversation = store.open(peer)
    conversation.unread = 0
    // pull server history once per session per conversation; dedup by
    // stanza-id keeps it from doubling messages we already cached
    if (account.status === 'connected' && !store.mamDone.has(conversation.peerJid)) {
      store.mamDone.add(conversation.peerJid)
      account.connection.queryArchive(
        conversation.peerJid,
        { max: 50, room: conversation.kind === 'muc' },
        () => undefined
      )
    }
    // tell the sender the latest incoming message was displayed
    const messages = conversation.messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message || message.outgoing || message.read) continue
      message.read = true
      const ref = message.wireId ?? message.id
      if (conversation.kind === 'dm' && ref) {
        account.connection.sendMarker(peer, ref, 'displayed')
      }
      break
    }
  }

  private bindAccount(accountJid: string): void {
    if (this.bound.has(accountJid)) return
    const account = accounts.list.find((a) => a.jid === accountJid)
    if (!account) return
    this.bound.add(accountJid)
    const store = this.chatsFor(accountJid)

    account.connection.events.on('message', (message) => {
      store.ingest(message, this.activePeer)
      // auto-receipt for chat messages that asked for one
      if (message.receiptRequest && message.body && message.type === 'chat' && message.id) {
        account.connection.sendReceipt(bareJid(message.from), message.id)
      }
    })
    account.connection.events.on('occupant', (occupant) => {
      store.setOccupant(occupant.room, {
        nick: occupant.nick,
        presence: occupant.presence,
        affiliation: occupant.affiliation,
        role: occupant.role,
        self: occupant.self
      })
    })
  }
}

export const app = new AppStore()
