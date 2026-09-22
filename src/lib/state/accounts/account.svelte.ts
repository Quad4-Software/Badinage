// The Account model: one connected session with its roster, presence,
// blocklist, bookmarks, avatars and room invites. Lifecycle wiring lives
// in lifecycle.ts, OMEMO init in omemo.ts and the per-feature behavior in
// the sibling helpers. The AccountsStore lives in store.svelte.ts.

import { SvelteMap, SvelteSet } from 'svelte/reactivity'

import { IrcConnection } from '$lib/core/irc/connection'
import { ModuleRegistry } from '$lib/core/module'
import { omemoModule, type OmemoService } from '$lib/core/omemo'
import type { SessionOptions } from '$lib/core/storage/session'
import { bareJid, jidDomain } from '$lib/utils/jid'
import {
  XmppConnection,
  type ChatConnection,
  type ConnectionStatus
} from '$lib/core/xmpp/connection'
import { DemoConnection } from '$lib/core/xmpp/demo'
import type { Bookmark, MucDecline } from '$lib/core/xmpp/stanzas'
import type { TransportCapabilities } from '$lib/core/xmpp/types'

import { settings } from '$lib/state/settings.svelte'

import { avatarHint, ensureAvatar, noteAvatarHash } from './avatars'
import { block, unblock, unblockAll } from './blocking'
import { addBookmark, refreshBookmarks, removeBookmark, setBookmarkNotify } from './bookmarks'
import { acceptSubscription, addContact, denySubscription, removeContact } from './contacts'
import { bindAccount, connectAccount } from './lifecycle'
import { disposeOmemoService, initOmemoService, pendingOmemo } from './omemo'
import { setInvisible, setPresence } from './presence'

import type { PendingInvite, PendingSubscription, RosterContact } from '../accounts.svelte'

export type AccountOptions = SessionOptions

// Store callbacks the account needs without importing the store: one
// oauth retry on authfail and fan-out for account-wide settings.
export interface AccountHooks {
  refreshOAuth(account: Account): void
  forEachAccount(fn: (account: Account) => void): void
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
  // inbound room invites, both direct (XEP-0249) and mediated
  roomInvites = $state<PendingInvite[]>([])
  // latest mediated decline relayed by a room, surfaced as a toast
  lastDecline = $state<MucDecline | null>(null)
  // our own advertised presence, re-sent after every reconnect
  presence = $state('online')
  presenceStatus = $state('')
  // XEP-0186: invisibility via a deny-presence-out privacy list, persisted
  // and reapplied on connect. Caveat: it also carries MUC joins
  invisible = $state(false)

  // protocol feature gates for the ui: the transport capability map
  // resolved so components read plain booleans, absent means supported
  get caps(): Required<TransportCapabilities> {
    const c = this.connection.capabilities
    const on = (v: boolean | undefined) => v !== false
    return {
      e2ee: on(c?.e2ee),
      upload: on(c?.upload),
      roster: on(c?.roster),
      subscriptions: on(c?.subscriptions),
      profile: on(c?.profile),
      roomConfig: on(c?.roomConfig),
      registration: on(c?.registration)
    }
  }

  setInvisible(on: boolean): void {
    setInvisible(this, on)
  }
  // XEP-0191 blocklist, kept in sync by server pushes
  blocked = new SvelteSet<string>()
  // OMEMO service, created by omemoModule after connect. Undefined in
  // demo mode until the first connect tick and in non-secure contexts
  omemo = $state<OmemoService | undefined>(undefined)
  // last omemo init failure, surfaced so the ui can warn that the
  // account is running in plaintext
  omemoError = $state<string | undefined>(undefined)
  // XEP-0199 last measured server round trip in ms, null until the first
  // pong lands and whenever the account drops offline
  latency = $state<number | null>(null)

  // avatar data uris by address: bare jid, room jid, room/nick, our own
  avatars = new SvelteMap<string, string>()
  // XEP-0402 PEP bookmarks by bare jid, empty until the fetch lands
  bookmarks = new SvelteMap<string, Bookmark>()

  private registry = new ModuleRegistry()

  // presence-advertised photo hashes. SvelteMap so a hash change re-runs
  // the ensureAvatar effects that read it
  private avatarHashes = new SvelteMap<string, string>()

  // session bookkeeping, intentionally plain collections: the reactive
  // surface is avatars/bookmarks, these only dedupe fetches and joins
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private avatarRequested = new Set<string>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private autoJoined = new Set<string>()
  // set once an expired oauth token has been refreshed this session so a
  // bad token cannot loop authfail -> refresh -> authfail
  oauthRefreshed = false

  constructor(
    readonly options: AccountOptions,
    private readonly hooks: AccountHooks
  ) {
    this.jid = options.jid
    this.connection = options.demo
      ? new DemoConnection()
      : options.protocol === 'irc'
        ? new IrcConnection(options.websocketUrl ?? '', jidDomain(options.jid), {
            persist: !options.untrusted,
            oauth: options.oauth
          })
        : new XmppConnection(options.websocketUrl ?? options.boshUrl ?? '', undefined, {
            oauth: options.oauth
          })
    // omemo only exists on transports that can carry it: irc reports
    // e2ee=false and anonymous jids are too throwaway to bind keys to
    if (this.connection.capabilities?.e2ee !== false && !this.options.anonymous) {
      this.registry.register(omemoModule)
    }
    bindAccount(this, this.hooks)
  }

  async connect(): Promise<void> {
    await connectAccount(this)
  }

  disconnect(): void {
    this.registry.destroyAll()
    this.connection.disconnect()
  }

  // module bootstrap lives behind a method so lifecycle.ts does not
  // reach into the private registry
  initModules(): void {
    void this.registry.initAll({ account: this, connection: this.connection })
  }

  // XEP-0352: forward ui visibility to the transport, which records the
  // desired state even before connect and replays <inactive/> once the
  // session comes up in a hidden tab
  setClientActive(active: boolean): void {
    this.connection.setClientActive(active)
  }

  addContact(jid: string, name = ''): void {
    addContact(this, jid, name)
  }

  removeContact(jid: string): void {
    removeContact(this, jid)
  }

  acceptSubscription(from: string): void {
    acceptSubscription(this, from)
  }

  denySubscription(from: string): void {
    denySubscription(this, from)
  }

  setPresence(show: string, status?: string): void {
    setPresence(this, show, status)
  }

  isBlocked(jid: string): boolean {
    return this.blocked.has(bareJid(jid))
  }

  block(jid: string): void {
    block(this, jid)
  }

  unblock(jid: string): void {
    unblock(this, jid)
  }

  unblockAll(): void {
    unblockAll(this)
  }

  async initOmemo(): Promise<void> {
    await initOmemoService(this)
  }

  // the service if it exists or is still being created, else undefined
  async omemoService(): Promise<OmemoService | undefined> {
    return this.omemo ?? (await pendingOmemo(this))
  }

  // kill the crypto worker on removal
  disposeOmemo(): void {
    disposeOmemoService(this)
  }

  setOmemoBlindTrust(enabled: boolean): void {
    settings.set('omemoBlindTrust', enabled)
    this.hooks.forEachAccount((account) => account.omemo?.setBlindTrust(enabled))
  }

  joinRoom(room: string, nick: string, password?: string): void {
    this.connection.joinRoom(bareJid(room), nick, password)
  }

  leaveRoom(room: string, nick: string): void {
    this.connection.leaveRoom(bareJid(room), nick)
  }

  // mediated decline through the room, per XEP-0045. Works for direct
  // XEP-0249 invites too since the decline always goes via the room
  declineRoomInvite(invite: PendingInvite, reason?: string): void {
    this.connection.declineRoomInvite(invite.room, invite.from, reason)
    this.dismissRoomInvite(invite)
  }

  dismissRoomInvite(invite: PendingInvite): void {
    const { room, from } = invite
    this.roomInvites = this.roomInvites.filter((i) => i.room !== room || i.from !== from)
  }

  // True when presence advertised a photo hash: rows gate on this so a
  // roster render never fans out into vcard queries.
  avatarHint(jid: string): boolean {
    return avatarHint(this.avatarHashes, jid)
  }

  // Lazily resolve an avatar into the avatars map. Unforced fetches only
  // run when presence hinted at a photo. Forced callers fetch regardless.
  ensureAvatar(jid: string, force = false): void {
    ensureAvatar(
      {
        hashes: this.avatarHashes,
        avatars: this.avatars,
        requested: this.avatarRequested,
        connection: this.connection,
        connected: this.status === 'connected'
      },
      jid,
      force
    )
  }

  // Called when presence or occupant updates carry a vcard photo hash:
  // a changed hash drops the cache, an empty hash pins no-avatar.
  noteAvatarHash(jid: string, hash: string | undefined): void {
    noteAvatarHash(this.avatarHashes, this.avatars, this.avatarRequested, jid, hash)
  }

  isBookmarked(jid: string): boolean {
    return this.bookmarks.has(bareJid(jid))
  }

  addBookmark(bookmark: Bookmark): void {
    addBookmark(this, this.autoJoined, bookmark)
  }

  removeBookmark(jid: string): void {
    removeBookmark(this, this.autoJoined, jid)
  }

  // The notification payload is deliberately not trusted: races between
  // resources are resolved by refetching the whole node, last write wins.
  refreshBookmarks(): void {
    refreshBookmarks(this, this.autoJoined)
  }

  // XEP-0492: sync a notification override onto the bookmark carrying
  // the conversation, preserving any extensions we did not author. Only
  // bookmarked chats sync. Unbookmarked dms keep a local-only setting.
  setBookmarkNotify(jid: string, notify: Bookmark['notify']): void {
    setBookmarkNotify(this, this.autoJoined, jid, notify)
  }

  // set by the app layer so a fetched bookmark can flow its notify
  // override into the conversation store (account cannot reach it)
  onBookmarksApplied: ((bookmarks: Bookmark[]) => void) | undefined
}
