import { SvelteMap } from 'svelte/reactivity'

import { settings } from '$lib/state/settings.svelte'
import { bareJid } from '$lib/utils/jid'

import { accounts } from './accounts.svelte'
import { ChatStore, type ChatMessage } from './chats.svelte'

export interface ComposerContext {
  // replying to this message
  replyTo?: ChatMessage | undefined
  // editing our own message
  editing?: ChatMessage | undefined
}

class AppStore {
  chats = new Map<string, ChatStore>()
  activePeer = $state<string | null>(null)
  // optional second chat pane (paneforge split view)
  splitPeer = $state<string | null>(null)
  sidebarOpen = $state(false)
  settingsOpen = $state(false)
  loginOpen = $state(false)
  joinRoomOpen = $state(false)
  addContactOpen = $state(false)
  // reply/edit context and focus callbacks are keyed per peer so split
  // panes keep independent composer state
  composerByPeer = new SvelteMap<string, ComposerContext>()
  private focusByPeer = new Map<string, () => void>()
  drafts = new Map<string, string>()

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

  draftKey(peer: string): string {
    return `${accounts.active?.jid ?? ''}:${bareJid(peer)}`
  }

  getDraft(peer: string): string {
    return this.drafts.get(this.draftKey(peer)) ?? ''
  }

  setDraft(peer: string, value: string): void {
    const key = this.draftKey(peer)
    if (value) this.drafts.set(key, value)
    else this.drafts.delete(key)
  }

  composerFor(peer: string): ComposerContext {
    return this.composerByPeer.get(this.draftKey(peer)) ?? {}
  }

  setComposer(peer: string, ctx: ComposerContext): void {
    const key = this.draftKey(peer)
    if (ctx.replyTo || ctx.editing) this.composerByPeer.set(key, ctx)
    else this.composerByPeer.delete(key)
  }

  registerComposerFocus(peer: string, focus: () => void): () => void {
    const key = this.draftKey(peer)
    this.focusByPeer.set(key, focus)
    return () => this.focusByPeer.delete(key)
  }

  focusComposer(peer: string | null): void {
    if (!peer) return
    this.focusByPeer.get(this.draftKey(peer))?.()
  }

  selectPeer(peer: string | null): void {
    const bare = peer ? bareJid(peer) : null
    // if the picked conversation lives in the split pane, swap the panes
    // instead of showing the same conversation twice
    if (bare && bare === this.splitPeer) {
      this.splitPeer = this.activePeer
    }
    this.activePeer = bare
    if (bare) this.composerByPeer.delete(this.draftKey(bare))
    if (!peer) return
    const account = accounts.active
    if (!account) return
    const store = this.chatsFor(account.jid)
    const conversation = store.open(peer)
    conversation.unread = 0
    // room avatars come from the room vCard, fetched once per session
    if (
      conversation.kind === 'muc' &&
      !conversation.avatarFetched &&
      account.status === 'connected'
    ) {
      conversation.avatarFetched = true
      account.connection.fetchAvatar(conversation.peerJid, (uri) => {
        if (uri) conversation.avatar = uri
      })
    }
    // pull server history once per session per conversation; dedup by
    // stanza-id keeps it from doubling messages we already cached. The
    // first page has no cursor yet so loadOlder fetches the latest page
    // and records the fin cursor for scroll-up paging.
    if (account.status === 'connected' && !store.mamDone.has(conversation.peerJid)) {
      store.mamDone.add(conversation.peerJid)
      store.loadOlder(conversation, account.connection)
    }
    // tell the sender the latest incoming message was displayed
    if (!settings.current.sendReadMarkers) return
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
      if (
        settings.current.sendReceipts &&
        message.receiptRequest &&
        message.body &&
        message.type === 'chat' &&
        message.id
      ) {
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
