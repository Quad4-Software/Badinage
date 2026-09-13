import { NS } from '$lib/core/xmpp/ns'
import { parseMdsItem, type IncomingMessage } from '$lib/core/xmpp/stanzas'
import { childElements } from '$lib/utils/xml'
import { settings } from '$lib/state/settings.svelte'
import { bareJid } from '$lib/utils/jid'

import { accounts, type Account } from './accounts.svelte'
import type { DeepLink } from './links'
import type { SharePayload } from '$lib/core/storage/share'
import { ChatStore, type ChatMessage } from './chats.svelte'
import { ComposerStore, type ComposerContext } from './composer.svelte'
import { RoomSessions } from './muc-session'
import { messageHandler } from './app/messages'
import { buildLiveEvent, publishDisplayed, type LiveMessage } from './app/live'

export type { LiveMessage }

class AppStore {
  chats = new Map<string, ChatStore>()
  activePeer = $state<string | null>(null)
  // optional second chat pane (paneforge split view)
  splitPeer = $state<string | null>(null)
  // desktop pane collapse state; the rail content is driven off the
  // pane's data-pane-state attribute, this mirrors it for other widgets
  sidebarCollapsed = $state(false)
  settingsOpen = $state(false)
  loginOpen = $state(false)
  joinRoomOpen = $state(false)
  addContactOpen = $state(false)
  paletteOpen = $state(false)
  // deep-link target consumed by the settings dialog on open
  pendingSettingsSection = $state<string | null>(null)
  // an xmpp: uri handed to us by the protocol handler or a pasted link;
  // the shell resolves it into a dialog or draft
  pendingLink = $state<DeepLink | null>(null)
  // a share_target payload dropped by the service worker, consumed by
  // the share dialog
  sharePayload = $state<SharePayload | null>(null)
  // drafts, reply/edit context and focus callbacks live in the composer
  // store; the methods below delegate, keyed per account:peer
  private composer = new ComposerStore()

  private handlers = new Map<string, () => void>()
  // jid -> Account: re-adding a removed account creates a new Account with
  // a new connection, so identity matters more than the jid string
  private bound = new Map<string, Account>()
  // per-account room watchdog (self-ping, rejoin, join errors)
  private roomSessions = new Map<string, RoomSessions>()

  chatsFor(accountJid: string): ChatStore {
    let store = this.chats.get(accountJid)
    if (!store) {
      // untrusted logins keep conversations in memory only
      const untrusted = accounts.list.find((a) => a.jid === accountJid)?.options.untrusted === true
      store = new ChatStore(accountJid, { persist: !untrusted })
      store.onLive = (peer, message, stored) => this.emitLive(accountJid, peer, message, stored)
      this.chats.set(accountJid, store)
    }
    this.bindAccount(accountJid)
    return store
  }

  // ui listeners for live incoming traffic (desktop notifications,
  // aria-live announcements); returns an unsubscribe
  private liveListeners = new Set<(event: LiveMessage) => void>()

  onLiveMessage(fn: (event: LiveMessage) => void): () => void {
    this.liveListeners.add(fn)
    return () => this.liveListeners.delete(fn)
  }

  private emitLive(
    accountJid: string,
    peer: string,
    message: IncomingMessage,
    stored?: ChatMessage
  ): void {
    if (this.liveListeners.size === 0) return
    const account = accounts.list.find((a) => a.jid === accountJid) ?? null
    const event = buildLiveEvent(accounts.list, this.chats, accountJid, peer, message, stored)
    // XEP-0490: while this conversation is open, advance the displayed
    // marker so our other devices can drop their unread counters
    if (peer === this.activePeer && message.stanzaId && !event.attention) {
      publishDisplayed(this.mdsPublished, account, peer, message.stanzaId, message.stanzaBy)
    }
    for (const listener of this.liveListeners) listener(event)
  }

  // last stanza-id published per account:peer so we do not republish the
  // same marker on every selectPeer/live message
  private mdsPublished = new Map<string, string>()

  private publishDisplayed(
    account: Account | null,
    peer: string,
    stanzaId: string,
    by?: string | undefined
  ): void {
    publishDisplayed(this.mdsPublished, account, peer, stanzaId, by)
  }

  registerAction(id: string, handler: () => void): () => void {
    this.handlers.set(id, handler)
    return () => this.handlers.delete(id)
  }

  dispatch(id: string): void {
    this.handlers.get(id)?.()
  }

  // Every join goes through here: the store remembers nick and password
  // before the presence goes out so the rejoin watchdog can replay them
  // and presence-error banners can retry without asking again.
  joinRoom(room: string, nick: string, password?: string): void {
    const account = accounts.active
    if (!account) return
    const bare = bareJid(room)
    const store = this.chatsFor(account.jid)
    store.noteJoin(bare, nick, password)
    account.joinRoom(bare, nick, password)
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
    return this.composer.key(accounts.active?.jid, peer)
  }

  getDraft(peer: string): string {
    return this.composer.draft(this.draftKey(peer))
  }

  setDraft(peer: string, value: string): void {
    this.composer.setDraft(this.draftKey(peer), value)
  }

  composerFor(peer: string): ComposerContext {
    return this.composer.context(this.draftKey(peer))
  }

  setComposer(peer: string, ctx: ComposerContext): void {
    this.composer.setContext(this.draftKey(peer), ctx)
  }

  registerComposerFocus(peer: string, focus: () => void): () => void {
    return this.composer.registerFocus(this.draftKey(peer), focus)
  }

  focusComposer(peer: string | null): void {
    if (!peer) return
    this.composer.focus(this.draftKey(peer))
  }

  selectPeer(peer: string | null): void {
    const bare = peer ? bareJid(peer) : null
    // if the picked conversation lives in the split pane, swap the panes
    // instead of showing the same conversation twice
    if (bare && bare === this.splitPeer) {
      this.splitPeer = this.activePeer
    }
    this.activePeer = bare
    if (bare) this.composer.clearContext(this.draftKey(bare))
    if (!peer) return
    const account = accounts.active
    if (!account) return
    const store = this.chatsFor(account.jid)
    const conversation = store.open(peer)
    conversation.unread = 0
    // the open conversation always gets its avatar: deduped and cached
    // by the transport layer so repeat selects cost nothing
    account.ensureAvatar(conversation.peerJid, true)
    // pull server history once per session per conversation; dedup by
    // stanza-id keeps it from doubling messages we already cached. The
    // first page has no cursor yet so loadOlder fetches the latest page
    // and records the fin cursor for scroll-up paging.
    if (account.status === 'connected' && !store.mamDone.has(conversation.peerJid)) {
      store.mamDone.add(conversation.peerJid)
      store.loadOlder(conversation, account.connection)
    }
    // tell the sender the latest unread incoming message was displayed,
    // and our other resources via the MDS marker on the newest incoming
    let lastIncoming: ChatMessage | undefined
    let lastUnread: ChatMessage | undefined
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const message = conversation.messages[i]
      if (!message || message.outgoing) break
      lastIncoming = message
      if (!message.read) {
        lastUnread = message
        break
      }
    }
    if (lastIncoming?.id) {
      this.publishDisplayed(account, conversation.peerJid, lastIncoming.id)
    }
    if (!settings.current.sendReadMarkers) return
    if (lastUnread) {
      lastUnread.read = true
      const ref = lastUnread.wireId ?? lastUnread.id
      if (conversation.kind === 'dm' && ref) {
        account.connection.sendMarker(peer, ref, 'displayed')
      }
    }
  }

  private bindAccount(accountJid: string): void {
    const account = accounts.list.find((a) => a.jid === accountJid)
    if (!account || this.bound.get(accountJid) === account) return
    this.bound.set(accountJid, account)
    const store = this.chatsFor(accountJid)
    // XEP-0492: bookmark notify overrides are shared state, so a fetch
    // overwrites the local preference for bookmarked conversations
    account.onBookmarksApplied = (bookmarks) => {
      for (const bookmark of bookmarks) {
        if (bookmark.notify === undefined) continue
        store.applyRemoteNotify(bookmark.jid, bookmark.notify)
      }
    }
    this.roomSessions.get(accountJid)?.dispose()
    const sessions = new RoomSessions(account.connection, store)
    this.roomSessions.set(accountJid, sessions)

    account.connection.events.on('status', (status) => {
      sessions.noteStatus(status)
      if (status === 'disconnected') void store.flush()
      if (status === 'connected') {
        // XEP-0490: pull the displayed markers our other resources
        // published while we were offline
        account.connection.pepGet(NS.MDS, undefined, (items) => {
          if (!items) return
          for (const item of childElements(items)) {
            const entry = parseMdsItem(item)
            if (entry) store.markDisplayedRemote(entry.peer, entry.stanzaId)
          }
        })
      }
    })

    // XEP-0490 push: our MDS node fans out when another resource
    // advances a displayed marker mid-session
    account.connection.events.on('mds', (items) => {
      for (const entry of items) store.markDisplayedRemote(entry.peer, entry.stanzaId)
    })

    account.connection.events.on('presenceError', (error) => {
      sessions.noteJoinError(error)
    })

    account.connection.events.on(
      'message',
      messageHandler(account, store, () => this.activePeer)
    )
    account.connection.events.on('occupant', (occupant) => {
      sessions.noteOccupant(occupant)
      // occupant avatars resolve under the room/nick address their
      // vcard is fetched from
      account.noteAvatarHash(`${occupant.room}/${occupant.nick}`, occupant.avatarHash)
      store.setOccupant(occupant.room, {
        nick: occupant.nick,
        presence: occupant.presence,
        affiliation: occupant.affiliation,
        role: occupant.role,
        self: occupant.self,
        codes: occupant.codes,
        jid: occupant.jid,
        occupantId: occupant.occupantId,
        newNick: occupant.newNick,
        reason: occupant.reason
      })
    })
  }

  // Called by AccountsStore before an account leaves the list: flush
  // pending writes, drop the stale binding, and clear the view if the
  // removed account was the active one. Returns the flush so removal can
  // wait for it before deleting the account's persisted data.
  releaseAccount(jid: string): Promise<void> {
    this.bound.delete(jid)
    this.roomSessions.get(jid)?.dispose()
    this.roomSessions.delete(jid)
    const store = this.chats.get(jid)
    const flushed = store?.flush() ?? Promise.resolve()
    store?.dispose()
    this.chats.delete(jid)
    if (accounts.active?.jid === jid) {
      this.activePeer = null
      this.splitPeer = null
    }
    return flushed
  }
}

export const app = new AppStore()

accounts.onRemoved((jid) => app.releaseAccount(jid))
