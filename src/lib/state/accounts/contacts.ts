// Roster contact and subscription handling for Account: add/remove and
// the accept/deny handshake. Free functions so accounts.svelte.ts stays
// under the size gate.

import { bareJid } from '$lib/utils/jid'

import type { Account } from '../accounts.svelte'

export function addContact(account: Account, jid: string, name = ''): void {
  account.connection.rosterSet(bareJid(jid), name)
  account.connection.sendDirectedPresence(bareJid(jid), 'subscribe')
}

export function removeContact(account: Account, jid: string): void {
  account.connection.rosterRemove(bareJid(jid))
}

export function acceptSubscription(account: Account, from: string): void {
  account.connection.sendDirectedPresence(from, 'subscribed')
  // ask for their presence back if not already subscribed
  account.connection.sendDirectedPresence(from, 'subscribe')
  account.subscriptions = account.subscriptions.filter((s) => s.from !== from)
}

export function denySubscription(account: Account, from: string): void {
  account.connection.sendDirectedPresence(from, 'unsubscribed')
  account.subscriptions = account.subscriptions.filter((s) => s.from !== from)
}
