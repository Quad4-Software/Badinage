// Avatar resolution for Account: the presence-advertised photo hash
// decides whether a vcard fetch is worth firing, and the requested set
// dedupes in-flight lookups for the session. Free functions so
// accounts.svelte.ts stays under the size gate.

import type { SvelteMap } from 'svelte/reactivity'

import type { ChatConnection } from '$lib/core/xmpp/connection'

export interface AvatarDeps {
  hashes: SvelteMap<string, string>
  avatars: SvelteMap<string, string>
  requested: Set<string>
  connection: ChatConnection
  connected: boolean
}

// Rows that only want an avatar when one provably exists gate on this so
// a roster render never fans out into vcard queries.
export function avatarHint(hashes: SvelteMap<string, string>, jid: string): boolean {
  return (hashes.get(jid) ?? '') !== ''
}

// Lazily resolve an avatar into the avatars map. Without force the fetch
// only runs when presence hinted at a photo; forced callers (open
// conversation, own account, room) fetch regardless. In-flight and
// failed lookups are deduped for the session by the transport layer and
// the requested set.
export function ensureAvatar(deps: AvatarDeps, jid: string, force = false): void {
  const hash = deps.hashes.get(jid)
  if (hash === '') return
  if (hash === undefined && !force) return
  if (deps.avatars.has(jid) || deps.requested.has(jid)) return
  if (!deps.connected) return
  deps.requested.add(jid)
  deps.connection.fetchAvatar(jid, (uri) => {
    if (uri) deps.avatars.set(jid, uri)
  })
}

// Called when presence or occupant updates carry a vcard-temp:x:update
// photo hash: a changed hash drops the cached image so mounted rows
// refetch, an empty hash pins the jid to no-avatar.
export function noteAvatarHash(
  hashes: SvelteMap<string, string>,
  avatars: SvelteMap<string, string>,
  requested: Set<string>,
  jid: string,
  hash: string | undefined
): void {
  if (hash === undefined) return
  if (hashes.get(jid) === hash) return
  hashes.set(jid, hash)
  avatars.delete(jid)
  if (hash === '') {
    requested.add(jid)
  } else {
    requested.delete(jid)
  }
}
