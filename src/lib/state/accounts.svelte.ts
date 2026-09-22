// Public surface for account state. The Account model lives in
// accounts/account.svelte.ts, the AccountsStore singleton in
// accounts/store.svelte.ts, and per-feature behavior in the sibling
// helpers under accounts/. Import from here so internals can move.

import type { MucInvite, RosterItem } from '$lib/core/xmpp/stanzas'

export { Account, type AccountOptions } from './accounts/account.svelte'
export { accounts } from './accounts/store.svelte'

export interface RosterContact extends RosterItem {
  presence: string
  presenceStatus: string
}

export interface PendingSubscription {
  from: string
  status: string
}

// An inbound room invite waiting for accept or decline in the sidebar.
export type PendingInvite = MucInvite

// App.svelte restores remembered logins through this re-export so ui/
// never touches core/ storage directly
export { restoreSessions } from '$lib/core/storage/session'
// the login form reads the remaining backoff through this re-export for
// the same reason
export { loginBackoffRemaining } from '$lib/core/storage/login-backoff'
