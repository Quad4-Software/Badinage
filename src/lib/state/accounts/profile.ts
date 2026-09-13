// Own-vcard (XEP-0054) helpers for Account: fetch the stored card for the
// profile editor and publish edits. Free functions so accounts.svelte.ts
// stays under the size gate.

import type { Vcard } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

import type { Account } from '../accounts.svelte'
import { setPresence } from './presence'

export function fetchProfile(account: Account, onDone: (vcard: Vcard | null) => void): void {
  if (account.status !== 'connected') {
    onDone(null)
    return
  }
  account.connection.vcard.fetch(onDone)
}

// Publishes the card and, on success, refreshes our own avatar entry and
// rebroadcasts presence so contacts learn the new XEP-0153 photo hash
// right away instead of after the next reconnect.
export function saveProfile(account: Account, vcard: Vcard, onDone: (ok: boolean) => void): void {
  account.connection.vcard.set(vcard, (ok) => {
    if (!ok) {
      onDone(false)
      return
    }
    const own = bareJid(account.jid)
    if (vcard.photoUri) {
      account.avatars.set(own, vcard.photoUri)
    } else {
      account.avatars.delete(own)
    }
    setPresence(account, account.presence)
    onDone(true)
  })
}
