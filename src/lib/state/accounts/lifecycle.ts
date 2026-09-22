// Connection lifecycle for Account: transport-specific connect logic
// and the event binding that folds connection events into account
// state. Free functions so account.svelte.ts stays under the size gate.

import { DEFAULT_RESOURCE } from '$lib/constants'
import { clearLoginBackoff, recordLoginFailure } from '$lib/core/storage/login-backoff'
import type { ConnectionStatus } from '$lib/core/xmpp/connection'
import { discoverEndpoints } from '$lib/core/xmpp/discovery'
import type { RosterItem } from '$lib/core/xmpp/stanzas'
import { bareJid, jidDomain } from '$lib/utils/jid'
import { settings } from '$lib/state/settings.svelte'

import type { AccountHooks } from './account.svelte'
import type { Account, RosterContact } from '../accounts.svelte'

export async function connectAccount(account: Account): Promise<void> {
  const { options } = account
  if (options.demo) {
    account.connection.connect(account.jid, options.password)
    return
  }
  if (options.protocol === 'irc') {
    // no endpoint discovery on irc: the websocket url is required and
    // the synthetic jid maps to nick + network domain
    if (!options.websocketUrl) {
      account.status = 'error'
      account.lastError = 'error'
    } else {
      account.connection.connect(bareJid(account.jid), options.password)
    }
    return
  }
  if (!options.websocketUrl && !options.boshUrl) {
    const endpoints = await discoverEndpoints(jidDomain(account.jid))
    options.websocketUrl = endpoints.websocket
    options.boshUrl = endpoints.bosh
  }
  const service = options.websocketUrl ?? options.boshUrl
  if (!service) {
    account.status = 'error'
    account.lastError = 'error'
    return
  }
  const resource = `${DEFAULT_RESOURCE}.${Math.random().toString(36).slice(2, 8)}`
  account.connection.connect(`${bareJid(account.jid)}/${resource}`, options.password)
}

export function bindAccount(account: Account, hooks: AccountHooks): void {
  const { connection } = account
  connection.events.on('latency', (ms) => {
    account.latency = ms
  })
  connection.events.on('status', (status) => onStatus(account, status, hooks))
  connection.events.on('roster', (items) => onRoster(account, items))
  connection.events.on('rosterUpdate', (item) => onRosterUpdate(account, item))
  connection.events.on('rosterRemove', (jid) => {
    account.roster = account.roster.filter((c) => c.jid !== jid)
  })
  connection.events.on('presence', (update) => {
    if (account.blocked.has(update.from)) return
    account.noteAvatarHash(update.from, update.avatarHash)
    const contact = account.roster.find((c) => c.jid === update.from)
    if (contact) {
      contact.presence = update.show
      contact.presenceStatus = update.status
    }
  })
  // PEP notifications mean another resource changed the node. Refetch
  connection.events.on('bookmarks', () => account.refreshBookmarks())
  connection.events.on('blocked', (jids) => {
    for (const jid of jids) account.blocked.add(bareJid(jid))
  })
  connection.events.on('unblocked', (jids) => {
    // an item-less unblock clears the whole list
    if (jids.length === 0) account.blocked.clear()
    for (const jid of jids) account.blocked.delete(bareJid(jid))
  })
  connection.events.on('subscriptionRequest', (request) => {
    if (account.blocked.has(request.from)) return
    if (!account.subscriptions.some((s) => s.from === request.from))
      account.subscriptions.push(request)
  })
  connection.events.on('roomInvite', (invite) => {
    if (account.blocked.has(bareJid(invite.from))) return
    const dupe = account.roomInvites.some((i) => i.room === invite.room && i.from === invite.from)
    if (!dupe) account.roomInvites.push(invite)
  })
  connection.events.on('roomDecline', (decline) => {
    account.lastDecline = decline
  })
}

function onStatus(account: Account, status: ConnectionStatus, hooks: AccountHooks): void {
  account.status = status
  if (status === 'authfail' || status === 'error') {
    account.lastError = status
    // every failure escalates the session-scoped login backoff
    recordLoginFailure(account.jid)
    // an expired oauth access token looks like authfail. One refresh
    // attempt per session keeps the user off the redirect treadmill
    if (status === 'authfail' && account.options.oauth && !account.oauthRefreshed) {
      account.oauthRefreshed = true
      hooks.refreshOAuth(account)
    }
  } else if (status === 'connecting' || status === 'connected') {
    account.lastError = null
  }
  if (status !== 'connected') account.latency = null
  if (status === 'connected') {
    clearLoginBackoff(account.jid)
    account.initModules()
    // XEP-0186: activate the persisted invisible flag BEFORE the
    // presence broadcast. The privacy list denies presence-out, so
    // sending presence first would leak a moment of online status to
    // every subscribed contact.
    const meta = settings.metaFor(account.jid)
    if (meta.invisible === true) {
      account.invisible = true
      account.connection.setInvisible(true, () => undefined)
    }
    // re-advertise our chosen presence. The transport only sends a
    // bare online presence on connect. While the invisible list is
    // active the server drops this outbound presence, which is the
    // intended behavior.
    account.connection.sendPresence(
      account.presence === 'online' ? undefined : account.presence,
      account.presenceStatus || undefined
    )
    account.connection.fetchBlocklist((jids) => {
      account.blocked.clear()
      for (const jid of jids) account.blocked.add(jid)
    })
    account.refreshBookmarks()
  }
}

function onRoster(account: Account, items: RosterItem[]): void {
  const previous: Record<string, RosterContact> = {}
  for (const contact of account.roster) previous[contact.jid] = contact
  account.roster = items.map((item) => ({
    ...item,
    presence: previous[item.jid]?.presence ?? 'offline',
    presenceStatus: previous[item.jid]?.presenceStatus ?? ''
  }))
}

function onRosterUpdate(account: Account, item: RosterItem): void {
  const index = account.roster.findIndex((c) => c.jid === item.jid)
  const patch = { ...item, presence: 'offline' as const, presenceStatus: '' }
  account.roster[index === -1 ? account.roster.length : index] = {
    ...account.roster[index],
    ...patch
  }
}
