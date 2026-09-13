import { SvelteMap, SvelteSet } from 'svelte/reactivity'

import { DEFAULT_RESOURCE } from '$lib/constants'
import { omemoModule, OmemoService } from '$lib/core/omemo'
import { ModuleRegistry } from '$lib/core/module'
import { clearSession, saveSession, type SessionOptions } from '$lib/core/storage/session'
import {
  XmppConnection,
  type Bookmark,
  type ChatConnection,
  type ConnectionStatus
} from '$lib/core/xmpp/connection'
import { DemoConnection } from '$lib/core/xmpp/demo'
import type { RosterItem } from '$lib/core/xmpp/stanzas'
import { discoverEndpoints } from '$lib/core/xmpp/discovery'
import { bareJid, jidDomain, parseJid } from '$lib/utils/jid'
import { settings } from '$lib/state/settings.svelte'

export type AccountOptions = SessionOptions

// App.svelte restores remembered logins through this re-export so ui/
// never touches core/ storage directly
export { restoreSessions } from '$lib/core/storage/session'

export interface RosterContact extends RosterItem {
  presence: string
  presenceStatus: string
}

export interface PendingSubscription {
  from: string
  status: string
}

export class Account {
  readonly jid: string
  readonly connection: ChatConnection

  status = $state<ConnectionStatus>('disconnected')
  // sticky copy of the last failure: status moves on to 'disconnected'
  // within the same tick, so a poller sampling status would miss it
  lastError = $state<'authfail' | 'error' | null>(null)
  roster = $state<RosterContact[]>([])
  subscriptions = $state<PendingSubscription[]>([])
  // our own advertised presence, re-sent after every reconnect
  presence = $state('online')
  presenceStatus = $state('')
  // XEP-0191 blocklist, kept in sync by server pushes
  blocked = new SvelteSet<string>()
  // OMEMO service, created by omemoModule after connect; undefined in
  // demo mode until the first connect tick and in non-secure contexts
  omemo = $state<OmemoService | undefined>(undefined)
  // last omemo init failure, surfaced so the ui can warn that the
  // account is running in plaintext
  omemoError = $state<string | undefined>(undefined)
  // resolved avatar data uris keyed by address: bare contact jid, room
  // jid, room/nick occupant key, or our own jid. Missing means initials.
  avatars = new SvelteMap<string, string>()
  // XEP-0402 PEP bookmarks keyed by the bookmarked bare jid; empty when
  // the server has no PEP or the fetch has not landed yet
  bookmarks = new SvelteMap<string, Bookmark>()

  private registry = new ModuleRegistry()

  // presence-advertised photo hashes; SvelteMap so a hash change re-runs
  // the ensureAvatar effects that read it
  private avatarHashes = new SvelteMap<string, string>()

  // session bookkeeping, intentionally plain collections: the reactive
  // surface is avatars/bookmarks, these only dedupe fetches and joins
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private avatarRequested = new Set<string>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private autoJoined = new Set<string>()

  constructor(readonly options: AccountOptions) {
    this.jid = options.jid
    this.connection = options.demo
      ? new DemoConnection()
      : new XmppConnection(options.websocketUrl ?? options.boshUrl ?? '')
    this.registry.register(omemoModule)
    this.bind()
  }

  async connect(): Promise<void> {
    if (this.options.demo) {
      this.connection.connect(this.jid, this.options.password)
      return
    }
    if (!this.options.websocketUrl && !this.options.boshUrl) {
      const endpoints = await discoverEndpoints(jidDomain(this.jid))
      this.options.websocketUrl = endpoints.websocket
      this.options.boshUrl = endpoints.bosh
    }
    const service = this.options.websocketUrl ?? this.options.boshUrl
    if (!service) {
      this.status = 'error'
      this.lastError = 'error'
      return
    }
    const resource = `${DEFAULT_RESOURCE}.${Math.random().toString(36).slice(2, 8)}`
    this.connection.connect(`${bareJid(this.jid)}/${resource}`, this.options.password)
  }

  disconnect(): void {
    this.registry.destroyAll()
    this.connection.disconnect()
  }

  // ---- contacts -------------------------------------------------------------

  addContact(jid: string, name = ''): void {
    this.connection.rosterSet(bareJid(jid), name)
    this.connection.sendDirectedPresence(bareJid(jid), 'subscribe')
  }

  removeContact(jid: string): void {
    this.connection.rosterRemove(bareJid(jid))
  }

  acceptSubscription(from: string): void {
    this.connection.sendDirectedPresence(from, 'subscribed')
    // ask for their presence back if not already subscribed
    this.connection.sendDirectedPresence(from, 'subscribe')
    this.subscriptions = this.subscriptions.filter((s) => s.from !== from)
  }

  denySubscription(from: string): void {
    this.connection.sendDirectedPresence(from, 'unsubscribed')
    this.subscriptions = this.subscriptions.filter((s) => s.from !== from)
  }

  // ---- presence -------------------------------------------------------------

  setPresence(show: string, status?: string): void {
    this.presence = show
    if (status !== undefined) this.presenceStatus = status
    if (this.status !== 'connected') return
    this.connection.sendPresence(
      show === 'online' ? undefined : show,
      this.presenceStatus || undefined
    )
  }

  // ---- blocking (XEP-0191) ----------------------------------------------------

  isBlocked(jid: string): boolean {
    return this.blocked.has(bareJid(jid))
  }

  block(jid: string): void {
    const bare = bareJid(jid)
    if (!bare) return
    // optimistic add; the server push confirms it for other resources
    this.blocked.add(bare)
    this.connection.blockJids([bare])
  }

  unblock(jid: string): void {
    const bare = bareJid(jid)
    this.blocked.delete(bare)
    this.connection.unblockJids([bare])
  }

  unblockAll(): void {
    this.blocked.clear()
    this.connection.unblockJids([])
  }

  // ---- OMEMO ----------------------------------------------------------------

  // creation promise is cached so callers can await the in-flight init
  // instead of racing it and sending a first message unencrypted
  private omemoInit: Promise<OmemoService | undefined> | undefined

  // Called by omemoModule on every connect: creates the service once,
  // then republishes our bundle and device list. Failures leave the
  // account running in plaintext.
  private omemoInitError: string | undefined

  async initOmemo(): Promise<void> {
    this.omemoError = undefined
    this.omemoInit ??= OmemoService.create({
      connection: this.connection,
      accountJid: this.jid,
      blindTrust: settings.current.omemoBlindTrust
    }).catch((err: unknown) => {
      this.omemoInitError = err instanceof Error ? err.message : String(err)
      console.warn('omemo init failed:', this.omemoInitError)
      return undefined
    })
    this.omemo = await this.omemoInit
    this.omemoError = this.omemoInitError
    if (!this.omemo) {
      // do not cache a failed init: the next connect retries from scratch
      this.omemoInit = undefined
    }
    await this.omemo?.publishOwn().catch((err: unknown) => {
      // a failed republish still leaves a working account
      console.warn('omemo publish failed:', err instanceof Error ? err.message : String(err))
    })
  }

  // Resolve the service if it exists or is still being created; undefined
  // when init never ran (disconnected) or creation failed.
  async omemoService(): Promise<OmemoService | undefined> {
    return this.omemo ?? (await this.omemoInit)
  }

  setOmemoBlindTrust(enabled: boolean): void {
    settings.set('omemoBlindTrust', enabled)
    for (const account of accounts.list) account.omemo?.setBlindTrust(enabled)
  }

  // ---- rooms -----------------------------------------------------------------

  joinRoom(room: string, nick: string, password?: string): void {
    this.connection.joinRoom(bareJid(room), nick, password)
  }

  leaveRoom(room: string, nick: string): void {
    this.connection.leaveRoom(bareJid(room), nick)
  }

  // ---- avatars (XEP-0153 + vcard-temp) --------------------------------------

  // True when presence advertised a non-empty photo hash for this address.
  // Rows that only want an avatar when one provably exists gate on this so
  // a roster render never fans out into vcard queries.
  avatarHint(jid: string): boolean {
    return (this.avatarHashes.get(jid) ?? '') !== ''
  }

  // Lazily resolve an avatar into the avatars map. Without force the fetch
  // only runs when presence hinted at a photo; forced callers (open
  // conversation, own account, room) fetch regardless. In-flight and
  // failed lookups are deduped for the session by the transport layer and
  // this requested set.
  ensureAvatar(jid: string, force = false): void {
    const hash = this.avatarHashes.get(jid)
    if (hash === '') return
    if (hash === undefined && !force) return
    if (this.avatars.has(jid) || this.avatarRequested.has(jid)) return
    if (this.status !== 'connected') return
    this.avatarRequested.add(jid)
    this.connection.fetchAvatar(jid, (uri) => {
      if (uri) this.avatars.set(jid, uri)
    })
  }

  // Called when presence or occupant updates carry a vcard-temp:x:update
  // photo hash: a changed hash drops the cached image so mounted rows
  // refetch, an empty hash pins the jid to no-avatar.
  noteAvatarHash(jid: string, hash: string | undefined): void {
    if (hash === undefined) return
    if (this.avatarHashes.get(jid) === hash) return
    this.avatarHashes.set(jid, hash)
    this.avatars.delete(jid)
    if (hash === '') {
      this.avatarRequested.add(jid)
    } else {
      this.avatarRequested.delete(jid)
    }
  }

  // ---- bookmarks (XEP-0402) --------------------------------------------------

  isBookmarked(jid: string): boolean {
    return this.bookmarks.has(bareJid(jid))
  }

  addBookmark(bookmark: Bookmark): void {
    const stored = { ...bookmark, jid: bareJid(bookmark.jid) }
    // optimistic: the server push resyncs every resource anyway, and a
    // failed publish triggers a refetch that restores server truth
    this.bookmarks.set(stored.jid, stored)
    this.connection.addBookmark(stored, (ok) => {
      if (!ok) this.refreshBookmarks()
    })
  }

  removeBookmark(jid: string): void {
    this.bookmarks.delete(bareJid(jid))
    this.connection.removeBookmark(bareJid(jid), (ok) => {
      if (!ok) this.refreshBookmarks()
    })
  }

  // The notification payload is deliberately not trusted: races between
  // resources are resolved by refetching the whole node, last write wins.
  private refreshBookmarks(): void {
    if (this.status !== 'connected') return
    this.connection.fetchBookmarks((bookmarks) => this.applyBookmarks(bookmarks))
  }

  private applyBookmarks(bookmarks: Bookmark[] | null): void {
    // null means the server has no PEP: stay a graceful no-op
    if (bookmarks === null) return
    this.bookmarks.clear()
    for (const bookmark of bookmarks) {
      this.bookmarks.set(bareJid(bookmark.jid), bookmark)
    }
    for (const bookmark of bookmarks) {
      if (bookmark.kind !== 'conference' || !bookmark.autojoin) continue
      const room = bareJid(bookmark.jid)
      // once per session per room: a notify refetch must not rejoin a
      // room the user deliberately left
      if (this.autoJoined.has(room)) continue
      this.autoJoined.add(room)
      this.joinRoom(room, bookmark.nick || parseJid(this.jid).local || 'me', bookmark.password)
    }
  }

  private bind(): void {
    this.connection.events.on('status', (status) => {
      this.status = status
      if (status === 'authfail' || status === 'error') {
        this.lastError = status
      } else if (status === 'connecting' || status === 'connected') {
        this.lastError = null
      }
      if (status === 'connected') {
        void this.registry.initAll({ account: this, connection: this.connection })
        // re-advertise our chosen presence; the transport only sends a
        // bare online presence on connect
        this.connection.sendPresence(
          this.presence === 'online' ? undefined : this.presence,
          this.presenceStatus || undefined
        )
        this.connection.fetchBlocklist((jids) => {
          this.blocked.clear()
          for (const jid of jids) this.blocked.add(jid)
        })
        this.refreshBookmarks()
      }
    })
    this.connection.events.on('roster', (items) => {
      const previous: Record<string, RosterContact> = {}
      for (const contact of this.roster) previous[contact.jid] = contact
      this.roster = items.map((item) => ({
        ...item,
        presence: previous[item.jid]?.presence ?? 'offline',
        presenceStatus: previous[item.jid]?.presenceStatus ?? ''
      }))
    })
    this.connection.events.on('rosterUpdate', (item) => {
      const index = this.roster.findIndex((c) => c.jid === item.jid)
      const patch = { ...item, presence: 'offline', presenceStatus: '' }
      const existing = index === -1 ? undefined : this.roster[index]
      if (existing) {
        this.roster[index] = { ...existing, ...patch }
      } else {
        this.roster.push(patch)
      }
    })
    this.connection.events.on('rosterRemove', (jid) => {
      this.roster = this.roster.filter((c) => c.jid !== jid)
    })
    this.connection.events.on('presence', (update) => {
      if (this.blocked.has(update.from)) return
      this.noteAvatarHash(update.from, update.avatarHash)
      const contact = this.roster.find((c) => c.jid === update.from)
      if (contact) {
        contact.presence = update.show
        contact.presenceStatus = update.status
      }
    })
    // PEP notifications mean another resource changed the node; refetch
    this.connection.events.on('bookmarks', () => this.refreshBookmarks())
    this.connection.events.on('blocked', (jids) => {
      for (const jid of jids) this.blocked.add(bareJid(jid))
    })
    this.connection.events.on('unblocked', (jids) => {
      // an item-less unblock clears the whole list
      if (jids.length === 0) this.blocked.clear()
      for (const jid of jids) this.blocked.delete(bareJid(jid))
    })
    this.connection.events.on('subscriptionRequest', (request) => {
      if (this.blocked.has(request.from)) return
      if (!this.subscriptions.some((s) => s.from === request.from)) {
        this.subscriptions.push(request)
      }
    })
  }
}

class AccountsStore {
  list = $state<Account[]>([])
  activeJid = $state<string | null>(null)

  private removeListeners: ((jid: string) => void)[] = []

  // subscribers (the app store) get a chance to flush and unbind before
  // the account leaves the list
  onRemoved(fn: (jid: string) => void): void {
    this.removeListeners.push(fn)
  }

  get active(): Account | undefined {
    return this.list.find((a) => a.jid === this.activeJid) ?? this.list[0]
  }

  async add(options: AccountOptions): Promise<Account> {
    const existing = this.list.find((a) => a.jid === options.jid)
    if (existing) {
      // a listed account that never got connected retries on re-add
      if (existing.status !== 'connected' && existing.status !== 'connecting') {
        void existing.connect()
      }
      return existing
    }
    const account = new Account(options)
    // the account joins the list only after the first successful connect:
    // keeps the login form mounted through authfail/error and drops a
    // session that never connects instead of leaving a dead entry. The
    // watcher is registered before connect so a synchronous demo connect
    // cannot slip past it.
    const off = account.connection.events.on('status', (status) => {
      if (status === 'connected') {
        off()
        this.list.push(account)
        this.activeJid ??= account.jid
        saveSession(options)
      } else if (status === 'authfail' || status === 'error' || status === 'disconnected') {
        off()
        // without this a failed first connect would auto-reconnect forever
        account.disconnect()
      }
    })
    await account.connect()
    return account
  }

  remove(jid: string): void {
    const index = this.list.findIndex((a) => a.jid === jid)
    const account = this.list[index]
    if (!account) return
    for (const fn of this.removeListeners) fn(jid)
    account.disconnect()
    this.list.splice(index, 1)
    clearSession(jid)
    if (this.activeJid === jid) this.activeJid = this.list[0]?.jid ?? null
  }
}

export const accounts = new AccountsStore()
