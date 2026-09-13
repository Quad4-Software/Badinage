// XEP-0191 blocklist handling for Account: optimistic set edits backed
// by server pushes. Free functions so accounts.svelte.ts stays under
// the size gate.

import { bareJid } from '$lib/utils/jid'

import type { Account } from '../accounts.svelte'

export function block(account: Account, jid: string): void {
  const bare = bareJid(jid)
  if (!bare) return
  // optimistic add. The server push confirms it for other resources
  account.blocked.add(bare)
  account.connection.blockJids([bare])
}

export function unblock(account: Account, jid: string): void {
  const bare = bareJid(jid)
  account.blocked.delete(bare)
  account.connection.unblockJids([bare])
}

export function unblockAll(account: Account): void {
  account.blocked.clear()
  account.connection.unblockJids([])
}
