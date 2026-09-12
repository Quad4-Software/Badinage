import { DEFAULT_RESOURCE } from '$lib/constants'
import { omemoModule } from '$lib/core/omemo'
import { ModuleRegistry } from '$lib/core/module'
import { scopedKey } from '$lib/core/storage/keys'
import { XmppConnection, type ConnectionStatus, type RosterItem } from '$lib/core/xmpp/connection'
import { discoverEndpoints } from '$lib/core/xmpp/discovery'
import { bareJid, jidDomain } from '$lib/utils/jid'

export interface AccountOptions {
  jid: string
  password: string
  websocketUrl?: string | undefined
  boshUrl?: string | undefined
  remember?: boolean | undefined
}

export interface RosterContact extends RosterItem {
  presence: string
  presenceStatus: string
}

export class Account {
  readonly jid: string
  readonly connection: XmppConnection

  status = $state<ConnectionStatus>('disconnected')
  roster = $state<RosterContact[]>([])

  private registry = new ModuleRegistry()

  constructor(readonly options: AccountOptions) {
    this.jid = options.jid
    this.connection = new XmppConnection(options.websocketUrl ?? options.boshUrl ?? '')
    this.registry.register(omemoModule)
    this.bind()
  }

  async connect(): Promise<void> {
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
        presenceStatus: ''
      }))
    })
    this.connection.events.on('presence', (update) => {
      const contact = this.roster.find((c) => c.jid === update.from)
      if (contact) {
        contact.presence = update.show
        contact.presenceStatus = update.status
      }
    })
  }
}

function persistSession(options: AccountOptions): void {
  if (options.remember) {
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
