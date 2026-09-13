import { SvelteSet } from 'svelte/reactivity'

import { DEFAULT_RESOURCE } from '$lib/constants'
import { InMemoryOmemoStore, omemoModule, OmemoService } from '$lib/core/omemo'
import { InMemoryTrustStore } from '$lib/core/omemo/trust'
import { ModuleRegistry } from '$lib/core/module'
import { clearLoginBackoff, recordLoginFailure } from '$lib/core/storage/login-backoff'
import { clearSession, saveSession, type SessionOptions } from '$lib/core/storage/session'
import {
  XmppConnection,
  type ChatConnection,
  type ConnectionStatus
} from '$lib/core/xmpp/connection'
import { DemoConnection } from '$lib/core/xmpp/demo'
import { RegisterError, registerAccount } from '$lib/core/xmpp/register'
import type { RosterItem } from '$lib/core/xmpp/stanzas'
import { discoverEndpoints } from '$lib/core/xmpp/discovery'
import { bareJid, jidDomain } from '$lib/utils/jid'
import { settings } from '$lib/state/settings.svelte'
import { deleteAccountData } from '$lib/state/storage'

export type AccountOptions = SessionOptions

// App.svelte restores remembered logins through this re-export so ui/
// never touches core/ storage directly
export { restoreSessions } from '$lib/core/storage/session'
// the login form reads the remaining backoff through this re-export for
// the same reason
export { loginBackoffRemaining } from '$lib/core/storage/login-backoff'

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
  // XEP-0199 last measured server round trip in ms, null until the first
  // pong lands and whenever the account drops offline
  latency = $state<number | null>(null)

  private registry = new ModuleRegistry()

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

  // XEP-0352: forward ui visibility to the transport, which records the
  // desired state even before connect and replays <inactive/> once the
  // session comes up in a hidden tab
  setClientActive(active: boolean): void {
    this.connection.setClientActive(active)
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
      blindTrust: settings.current.omemoBlindTrust,
      // untrusted devices keep key material and trust decisions in memory
      // only; nothing OMEMO-shaped reaches IndexedDB
      ...(this.options.untrusted
        ? { omemoStore: new InMemoryOmemoStore(), trustStore: new InMemoryTrustStore() }
        : {})
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

  private bind(): void {
    this.connection.events.on('latency', (ms) => {
      this.latency = ms
    })
    this.connection.events.on('status', (status) => {
      this.status = status
      if (status === 'authfail' || status === 'error') {
        this.lastError = status
        // every failure escalates the session-scoped login backoff
        recordLoginFailure(this.jid)
      } else if (status === 'connecting' || status === 'connected') {
        this.lastError = null
      }
      if (status !== 'connected') this.latency = null
      if (status === 'connected') {
        clearLoginBackoff(this.jid)
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
      const contact = this.roster.find((c) => c.jid === update.from)
      if (contact) {
        contact.presence = update.show
        contact.presenceStatus = update.status
      }
    })
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

  private removeListeners: ((jid: string) => void | Promise<void>)[] = []

  // subscribers (the app store) get a chance to flush and unbind before
  // the account leaves the list; returned promises are awaited before
  // the account's persisted data is deleted
  onRemoved(fn: (jid: string) => void | Promise<void>): void {
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
        this.applyOrder()
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

  // XEP-0077 in-band registration on a throwaway websocket, then the
  // caller logs in through the normal add() path. Resolves with the
  // machine-readable failure reason instead of throwing so the ui can
  // pick a locale string without importing core types.
  async register(
    jid: string,
    password: string,
    server?: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      let websocketUrl = server
      if (!websocketUrl) {
        websocketUrl = (await discoverEndpoints(jidDomain(jid))).websocket
      }
      if (!websocketUrl) return { ok: false, reason: 'unsupported' }
      await registerAccount(websocketUrl, jid, password)
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof RegisterError ? err.reason : 'error' }
    }
  }

  remove(jid: string): void {
    const account = this.list.find((a) => a.jid === jid)
    if (!account) return
    void this.teardown(account)
  }

  // Let listeners flush pending writes first, then disconnect, drop the
  // account and delete its persisted data. The delete runs after the
  // flush so a late debounced snapshot cannot outlive the removal.
  private async teardown(account: Account): Promise<void> {
    try {
      await Promise.all(this.removeListeners.map((fn) => fn(account.jid)))
    } finally {
      account.disconnect()
      this.list = this.list.filter((a) => a !== account)
      clearSession(account.jid)
      if (this.activeJid === account.jid) this.activeJid = this.list[0]?.jid ?? null
      const order = settings.current.accountOrder
      if (order.includes(account.jid)) {
        settings.set(
          'accountOrder',
          order.filter((entry) => entry !== account.jid)
        )
      }
    }
    await deleteAccountData(account.jid).catch((error: unknown) => {
      console.warn(
        `failed to delete local data for ${account.jid}:`,
        error instanceof Error ? error.message : String(error)
      )
    })
  }

  // move an account one step in the switcher order and persist the new
  // arrangement; activeJid is untouched so the view does not jump
  move(jid: string, delta: -1 | 1): void {
    const from = this.list.findIndex((a) => a.jid === jid)
    const to = from + delta
    if (from < 0 || to < 0 || to >= this.list.length) return
    const [item] = this.list.splice(from, 1)
    if (!item) return
    this.list.splice(to, 0, item)
    settings.set(
      'accountOrder',
      this.list.map((a) => a.jid)
    )
  }

  // sort the live list by the persisted preference; unlisted jids keep
  // their arrival order at the end (sort is stable)
  private applyOrder(): void {
    const order = settings.current.accountOrder
    if (order.length === 0) return
    const rank = new Map(order.map((jid, i) => [jid, i]))
    this.list.sort((a, b) => (rank.get(a.jid) ?? order.length) - (rank.get(b.jid) ?? order.length))
  }
}

export const accounts = new AccountsStore()
