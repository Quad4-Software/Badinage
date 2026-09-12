import { DEFAULT_RESOURCE } from '$lib/constants'
import { omemoModule } from '$lib/core/omemo'
import { ModuleRegistry } from '$lib/core/module'
import { scopedKey } from '$lib/core/storage/keys'
import {
  XmppConnection,
  type ChatConnection,
  type ConnectionStatus
} from '$lib/core/xmpp/connection'
import { DemoConnection } from '$lib/core/xmpp/demo'
import type { RosterItem } from '$lib/core/xmpp/stanzas'
import { discoverEndpoints } from '$lib/core/xmpp/discovery'
import { bareJid, jidDomain } from '$lib/utils/jid'

export interface AccountOptions {
  jid: string
  password: string
  websocketUrl?: string | undefined
  boshUrl?: string | undefined
  remember?: boolean | undefined
  demo?: boolean | undefined
}

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
  roster = $state<RosterContact[]>([])
  subscriptions = $state<PendingSubscription[]>([])

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

  // ---- rooms -----------------------------------------------------------------

  joinRoom(room: string, nick: string, password?: string): void {
    this.connection.joinRoom(bareJid(room), nick, password)
  }

  leaveRoom(room: string, nick: string): void {
    this.connection.leaveRoom(bareJid(room), nick)
  }

  private bind(): void {
    this.connection.events.on('status', (status) => {
      this.status = status
      if (status === 'connected') void this.registry.initAll({ account: this })
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
      const contact = this.roster.find((c) => c.jid === update.from)
      if (contact) {
        contact.presence = update.show
        contact.presenceStatus = update.status
      }
    })
    this.connection.events.on('subscriptionRequest', (request) => {
      if (!this.subscriptions.some((s) => s.from === request.from)) {
        this.subscriptions.push(request)
      }
    })
  }
}

function persistSession(options: AccountOptions): void {
  if (options.remember && !options.demo) {
    sessionStorage.setItem(scopedKey(options.jid, 'session'), JSON.stringify(options))
  }
}

export function restoreSessions(): AccountOptions[] {
  const restored: AccountOptions[] = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i)
    if (!key?.endsWith(':session')) continue
    try {
      restored.push(JSON.parse(sessionStorage.getItem(key) ?? '') as AccountOptions)
    } catch {
      sessionStorage.removeItem(key)
    }
  }
  return restored
}

class AccountsStore {
  list = $state<Account[]>([])
  activeJid = $state<string | null>(null)

  get active(): Account | undefined {
    return this.list.find((a) => a.jid === this.activeJid) ?? this.list[0]
  }

  async add(options: AccountOptions): Promise<Account> {
    const existing = this.list.find((a) => a.jid === options.jid)
    if (existing) return existing
    const account = new Account(options)
    this.list.push(account)
    this.activeJid ??= account.jid
    persistSession(options)
    await account.connect()
    return account
  }

  remove(jid: string): void {
    const index = this.list.findIndex((a) => a.jid === jid)
    const account = this.list[index]
    if (!account) return
    account.disconnect()
    this.list.splice(index, 1)
    sessionStorage.removeItem(scopedKey(jid, 'session'))
    if (this.activeJid === jid) this.activeJid = this.list[0]?.jid ?? null
  }
}

export const accounts = new AccountsStore()
