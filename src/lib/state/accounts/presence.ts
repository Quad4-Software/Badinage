// Presence handling for Account: local presence state and the XEP-0186
// invisibility toggle. Free functions so accounts.svelte.ts stays under
// the size gate.

import { settings } from '$lib/state/settings.svelte'

import type { Account } from '../accounts.svelte'

export function setPresence(account: Account, show: string, status?: string): void {
  account.presence = show
  if (status !== undefined) account.presenceStatus = status
  if (account.status !== 'connected') return
  account.connection.sendPresence(
    show === 'online' ? undefined : show,
    account.presenceStatus || undefined
  )
}

// XEP-0186 invisibility via a deny-presence-out privacy list, persisted
// per account and reapplied on every connect.
export function setInvisible(account: Account, on: boolean): void {
  account.invisible = on
  settings.setAccountMeta(account.jid, { invisible: on })
  if (account.status !== 'connected') return
  account.connection.setInvisible(on, (ok) => {
    if (!ok) {
      // server refused (no privacy list support): snap the flag back
      account.invisible = !on
      settings.setAccountMeta(account.jid, { invisible: !on })
    }
  })
}
