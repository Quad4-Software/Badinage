import { OMEMO_RETRY_QUEUE_MAX } from '$lib/constants'
import type { Attachment, IncomingMessage } from '$lib/core/xmpp/stanzas'
import { settings } from '$lib/state/settings.svelte'
import { bareJid } from '$lib/utils/jid'

import { accounts, type Account } from './accounts.svelte'
import { ChatStore } from './chats.svelte'
import { ComposerStore, type ComposerContext } from './composer.svelte'
import { RoomSessions } from './muc-session'

// one live incoming message, resolved for ui consumers (notifications,
// aria-live). sender is already display-ready and encrypted is precomputed
// so listeners never need to look up roster or conversation state.
export interface LiveMessage {
  accountJid: string
  peer: string
  sender: string
  // true when the stanza or conversation is omemo-encrypted: listeners
  // must show a generic label instead of the body
  encrypted: boolean
  body: string
  attachment?: Attachment | undefined
}

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
      store.onLive = (peer, message) => this.emitLive(accountJid, peer, message)
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

  private emitLive(accountJid: string, peer: string, message: IncomingMessage): void {
    if (this.liveListeners.size === 0) return
    const account = accounts.list.find((a) => a.jid === accountJid)
    const conversation = this.chats.get(accountJid)?.conversations.get(peer)
    const rosterName = account?.roster.find((c) => c.jid === bareJid(message.from))?.name
    const event: LiveMessage = {
      accountJid,
      peer,
      sender:
        message.type === 'groupchat' ? (message.nick ?? peer) : rosterName || bareJid(message.from),
      encrypted: Boolean(message.encrypted || message.undecryptable || conversation?.encrypted),
      body: message.body,
      attachment: message.attachments?.[0]
    }
    for (const listener of this.liveListeners) listener(event)
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
    const account = accounts.list.find((a) => a.jid === accountJid)
    if (!account || this.bound.get(accountJid) === account) return
    this.bound.set(accountJid, account)
    const store = this.chatsFor(accountJid)
    this.roomSessions.get(accountJid)?.dispose()
    const sessions = new RoomSessions(account.connection, store)
    this.roomSessions.set(accountJid, sessions)

    // undecryptable omemo stanzas waiting on a session repair, keyed by
    // namespace + sender + sending device. Retried exactly once when a
    // later stanza from the same device decrypts, then dropped. Internal
    // bookkeeping only - no reactivity needed.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const undecryptable = new Map<string, IncomingMessage[]>()
    const queueKey = (ns: string, from: string, sid: number) => `${ns}:${bareJid(from)}/${sid}`

    account.connection.events.on('status', (status) => {
      sessions.noteStatus(status)
      if (status === 'disconnected') void store.flush()
    })

    account.connection.events.on('presenceError', (error) => {
      sessions.noteJoinError(error)
    })

    account.connection.events.on('message', (message) => {
      // locally ignored peers never reach the store, even when the
      // server has no XEP-0191 support to filter them for us
      if (account.blocked.has(bareJid(message.from))) return

      // omemo stanzas carry their real body inside the envelope; decrypt
      // first, then run the normal ingest and receipt path
      if (message.encryptedXml) {
        const omemo = account.omemo
        if (!omemo) {
          message.encrypted = true
          message.undecryptable = true
          message.body = ''
          store.ingest(message, this.activePeer)
          return
        }
        void omemo.decryptInto(message).then((report) => {
          if (account.blocked.has(bareJid(message.from))) return
          const stored = store.ingest(message, this.activePeer)
          if (
            settings.current.sendReceipts &&
            message.receiptRequest &&
            message.body &&
            message.type === 'chat' &&
            message.id
          ) {
            account.connection.sendReceipt(bareJid(message.from), message.id)
          }
          if (
            report.status === 'failed' &&
            report.sid !== undefined &&
            report.namespace !== undefined &&
            message.type === 'chat'
          ) {
            const key = queueKey(report.namespace, message.from, report.sid)
            const list = undecryptable.get(key) ?? []
            list.push(message)
            if (list.length > OMEMO_RETRY_QUEUE_MAX) list.shift()
            undecryptable.set(key, list)
            void omemo.sendKeyTransport(message.from, report.sid, report.namespace).then((sent) => {
              if (sent && stored) stored.keyRequested = true
            })
            return
          }
          if (
            (report.status === 'decrypted' || report.status === 'empty') &&
            message.type === 'chat'
          ) {
            // the session with this device now works; give each queued
            // stanza from it one retry, then drop it for good
            const key = queueKey(report.namespace ?? '', message.from, report.sid ?? 0)
            const queued = undecryptable.get(key)
            if (!queued?.length) return
            undecryptable.delete(key)
            for (const stale of queued) {
              void omemo.decryptInto(stale).then((retry) => {
                // 'decrypted' patches the payload in; 'empty' carried no
                // payload and 'duplicate' means a resend already landed,
                // so the tombstone is stale either way
                if (
                  retry.status === 'decrypted' ||
                  retry.status === 'empty' ||
                  retry.status === 'duplicate'
                ) {
                  store.resolveDecrypted(stale)
                }
              })
            }
          }
        })
        return
      }

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
