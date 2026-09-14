// Per-account IRC lists. IRC has no server-side roster, blocklist or
// bookmarks store, so these persist in localStorage scoped to the
// account bare jid and are pushed to the server where a mechanism
// exists (MONITOR for contacts, JOIN for channels).

import { scopedKey } from '$lib/core/storage/keys'
import type { Bookmark, MamPageResult, RosterItem } from '$lib/core/xmpp/stanzas'

import { jidToTarget, targetToJid, type ISupport } from './address'
import { ircLower } from './line'
import { monitor, type IrcSend } from './outbound'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// in-memory stand-in where the platform lacks localStorage (tests,
// workers). Module-level so every list sees the same data
const memory = new Map<string, string>()
const memoryStore: Store = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key)
}

function store(): Store {
  return typeof localStorage === 'undefined' ? memoryStore : localStorage
}

function loadList(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(store().getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// events the lists emit when a mutation lands, wired to the
// connection's typed emitter
export interface ListHooks {
  rosterUpdate(item: RosterItem): void
  rosterRemove(jid: string): void
  blocked(jids: string[]): void
  unblocked(jids: string[]): void
}

export class AccountLists {
  private monitored = new Set<string>()
  private ignored = new Set<string>()
  private autojoin = new Set<string>()
  private bare = ''

  constructor(
    private readonly persist: boolean,
    private readonly domain: string,
    private readonly isupport: ISupport,
    private readonly hooks: ListHooks
  ) {}

  private lower(name: string): string {
    return ircLower(name, this.isupport.casemapping)
  }

  load(accountBare: string): void {
    this.bare = accountBare
    if (!this.persist) return
    this.monitored = new Set(
      loadList(scopedKey(accountBare, 'irc-monitor')).map((n) => this.lower(n))
    )
    this.ignored = new Set(loadList(scopedKey(accountBare, 'irc-ignore')).map((n) => this.lower(n)))
    this.autojoin = new Set(
      loadList(scopedKey(accountBare, 'irc-autojoin')).map((n) => this.lower(n))
    )
  }

  private save(key: string, values: Set<string>): void {
    if (this.persist && this.bare) {
      store().setItem(scopedKey(this.bare, key), JSON.stringify([...values]))
    }
  }

  rosterItems(): RosterItem[] {
    return [...this.monitored].map((nick) => ({
      jid: targetToJid(nick, this.domain, this.isupport),
      name: nick,
      subscription: 'both' as const,
      groups: []
    }))
  }

  hasMonitored(nick: string): boolean {
    return this.monitored.has(this.lower(nick))
  }

  // returns the lowercase nick to send MONITOR + for, or undefined if
  // already tracked
  addContact(jid: string): string | undefined {
    const nick = jidToTarget(jid)
    const lower = this.lower(nick)
    if (this.monitored.has(lower)) return undefined
    this.monitored.add(lower)
    this.save('irc-monitor', this.monitored)
    return lower
  }

  removeContact(jid: string): string | undefined {
    const nick = jidToTarget(jid)
    const lower = this.lower(nick)
    if (!this.monitored.delete(lower)) return undefined
    this.save('irc-monitor', this.monitored)
    return lower
  }

  pushMonitor(send: IrcSend): void {
    if (this.monitored.size > 0) monitor(send, [...this.monitored], [])
  }

  // a contact renamed: follow the nick so later away and quit traffic
  // still resolves to presence, and the roster entry tracks the new
  // address. Returns the lowercase new nick for the caller to monitor,
  // or undefined when the old nick was not watched
  renameMonitored(oldNick: string, newNick: string): string | undefined {
    if (!this.monitored.delete(this.lower(oldNick))) return undefined
    const lower = this.lower(newNick)
    this.monitored.add(lower)
    this.save('irc-monitor', this.monitored)
    this.hooks.rosterRemove(targetToJid(oldNick, this.domain, this.isupport))
    this.hooks.rosterUpdate({
      jid: targetToJid(newNick, this.domain, this.isupport),
      name: newNick,
      subscription: 'both',
      groups: []
    })
    return lower
  }

  // rosterSet equivalent: track the nick, start monitoring, emit the
  // roster update. MONITOR S reports current state immediately
  setContact(send: IrcSend, jid: string, name: string): void {
    const nick = this.addContact(jid)
    if (!nick) return
    monitor(send, [nick], [])
    send.raw(`MONITOR S ${nick}`)
    this.hooks.rosterUpdate({
      jid: targetToJid(nick, this.domain, this.isupport),
      name: name || nick,
      subscription: 'both',
      groups: []
    })
  }

  dropContact(send: IrcSend, jid: string): void {
    const nick = this.removeContact(jid)
    if (!nick) return
    monitor(send, [], [nick])
    this.hooks.rosterRemove(targetToJid(nick, this.domain, this.isupport))
  }

  blockedJids(): string[] {
    return [...this.ignored].map((nick) => targetToJid(nick, this.domain, this.isupport))
  }

  isBlocked(nick: string): boolean {
    return this.ignored.has(this.lower(nick))
  }

  blockJids(jids: string[]): void {
    for (const jid of jids) this.ignored.add(this.lower(jidToTarget(jid)))
    this.save('irc-ignore', this.ignored)
    this.hooks.blocked(jids)
  }

  unblockJids(jids: string[]): void {
    if (jids.length === 0) this.ignored.clear()
    for (const jid of jids) this.ignored.delete(this.lower(jidToTarget(jid)))
    this.save('irc-ignore', this.ignored)
    this.hooks.unblocked(jids)
  }

  bookmarks(): Bookmark[] {
    return [...this.autojoin].map((channel) => ({
      jid: targetToJid(channel, this.domain, this.isupport),
      kind: 'conference' as const,
      autojoin: true
    }))
  }

  autojoinChannels(): string[] {
    return [...this.autojoin]
  }

  addAutojoin(jid: string): string {
    const channel = jidToTarget(jid)
    this.autojoin.add(this.lower(channel))
    this.save('irc-autojoin', this.autojoin)
    return channel
  }

  // addBookmark equivalent: persist the channel and join it when the
  // link is up. The wire JOIN is the caller's because only it knows
  // the connection state
  addBookmark(send: IrcSend, bookmark: Bookmark, connected: boolean): void {
    const channel = this.addAutojoin(bookmark.jid)
    if (connected) send.raw(`JOIN ${channel}`)
  }

  removeAutojoin(jid: string): void {
    this.autojoin.delete(this.lower(jidToTarget(jid)))
    this.save('irc-autojoin', this.autojoin)
  }
}

interface QueuedHistory {
  target: string
  before?: string | undefined
  limit: number
  onDone: (result: MamPageResult) => void
}

// one CHATHISTORY at a time: batches have no request id, so concurrent
// queries cannot be told apart
export class HistoryQueue {
  private pending: QueuedHistory | null = null
  private readonly queue: QueuedHistory[] = []

  // onStart fires when a query becomes active. The owner notes the
  // limit on the inbound dispatcher, then sends CHATHISTORY
  constructor(
    private readonly supported: () => boolean,
    private readonly onStart: (query: QueuedHistory) => void
  ) {}

  enqueue(
    peerJid: string,
    before: string | undefined,
    max: number | undefined,
    onDone: (result: MamPageResult) => void
  ): void {
    if (!this.supported()) {
      onDone({ complete: true })
      return
    }
    const query: QueuedHistory = {
      target: peerJid,
      ...(before !== undefined ? { before } : {}),
      limit: max ?? 50,
      onDone
    }
    if (this.pending) {
      this.queue.push(query)
      return
    }
    this.pending = query
    this.onStart(query)
  }

  finish(result: MamPageResult): void {
    const pending = this.pending
    this.pending = null
    pending?.onDone(result)
    const next = this.queue.shift()
    if (next) {
      this.pending = next
      this.onStart(next)
    }
  }

  reset(): void {
    const pending = this.pending
    this.pending = null
    this.queue.length = 0
    pending?.onDone({ complete: true })
  }
}
