// vcard-temp avatars (XEP-0153): iq fetch of the PHOTO element backed by
// an IndexedDB cache keyed on the sha1 hash contacts advertise in their
// presence update element. Repeat views and contacts that happen to share
// a photo never hit the wire twice.
//
// The fetch is deliberately lazy: the state layer asks for an avatar only
// when a row or header actually renders, so opening the roster never
// fans out into hundreds of vcard queries. Callers that want stricter
// laziness can gate on the advertised hash via noteAvatarHash.

import { $iq } from 'strophe.js'

import { AVATAR_FETCH_CONCURRENCY, AVATAR_MAX_BYTES, AVATAR_TIMEOUT_MS } from '$lib/constants'
import { idb } from '$lib/core/storage/idb'
import { globalKey, scopedKey } from '$lib/core/storage/keys'
import { bareJid } from '$lib/utils/jid'
import { base64ToBytes, bytesToBase64, sha1Hex } from '$lib/utils/protocol/sha1'

import { NS } from '../../ns'
import { parseVcardPhoto } from '../../stanzas'
import type { XmppTransport } from '../transport'

// the cache is only reachable when indexedDB exists (unit tests run
// without it and simply skip persistence)
const hasIdb = typeof indexedDB !== 'undefined'

interface AvatarEntry {
  // null is a real result too: the jid has no usable photo this session
  value: string | null
  waiters?: ((value: string | undefined) => void)[] | undefined
}

interface AvatarState {
  // session results per requested jid (bare contact jid, room jid,
  // room/nick occupant key, own jid)
  byJid: Map<string, AvatarEntry>
  // jid -> sha1 hex advertised through vcard-temp:x:update in presence;
  // the empty string means the contact says there is no avatar
  hashes: Map<string, string>
  // wire fetch concurrency: extra requests queue behind the in-flight set
  inFlight: number
  queue: (() => void)[]
}

const states = new WeakMap<XmppTransport, AvatarState>()

function stateFor(conn: XmppTransport): AvatarState {
  let state = states.get(conn)
  if (!state) {
    state = { byJid: new Map(), hashes: new Map(), inFlight: 0, queue: [] }
    states.set(conn, state)
  }
  return state
}

function avatarKey(hash: string): string {
  return globalKey('avatar', hash)
}

function jidHashKey(conn: XmppTransport, jid: string): string {
  return scopedKey(bareJid(conn.jid), 'avatar-hash', jid)
}

// XEP-0153: presence carries the sha1 of the current photo bytes. A
// changed hash invalidates the session entry so the next request
// refetches; an empty photo element means the contact dropped the avatar.
export function noteAvatarHash(conn: XmppTransport, jid: string, hash: string | undefined): void {
  if (hash === undefined) return
  const state = stateFor(conn)
  if (state.hashes.get(jid) === hash) return
  state.hashes.set(jid, hash)
  if (hash === '') {
    // explicitly no avatar: answer future requests without a query
    state.byJid.set(jid, { value: null })
  } else {
    state.byJid.delete(jid)
  }
}

async function loadCachedAvatar(hash: string): Promise<string | null> {
  if (!hasIdb) return null
  try {
    return (await idb.get<string>('kv', avatarKey(hash))) ?? null
  } catch {
    return null
  }
}

async function loadJidHash(conn: XmppTransport, jid: string): Promise<string | null> {
  if (!hasIdb) return null
  try {
    return (await idb.get<string>('kv', jidHashKey(conn, jid))) ?? null
  } catch {
    return null
  }
}

function persistAvatar(conn: XmppTransport, jid: string, hash: string, uri: string): void {
  if (!hasIdb) return
  void idb.set('kv', avatarKey(hash), uri).catch(() => undefined)
  void idb.set('kv', jidHashKey(conn, jid), hash).catch(() => undefined)
}

// Validate and normalize the data uri out of the vcard: the BINVAL half
// is decoded (stray whitespace and garbage tolerated), oversized payloads
// dropped, and the result re-encoded so callers get a clean uri. Returns
// the uri plus the sha1 hex of the photo bytes for the cache key.
function decodePhoto(uri: string): { uri: string; hash: string } | null {
  const comma = uri.indexOf(',')
  if (!uri.startsWith('data:') || comma === -1) return null
  const header = uri.slice(5, comma)
  const bytes = base64ToBytes(uri.slice(comma + 1))
  if (!bytes || bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) return null
  return { uri: `data:${header},${bytesToBase64(bytes)}`, hash: sha1Hex(bytes) }
}

// vcard-temp PHOTO fetch for any jid: roster contact, room, room/nick
// occupant or our own bare jid. Resolves with a data uri, or null when
// the peer has no photo, the payload is unusable, or the query fails.
// Repeat calls for the same jid are deduped and cached for the session.
export function fetchAvatar(
  conn: XmppTransport,
  jid: string,
  onDone: (dataUri: string | undefined) => void
): void {
  const state = stateFor(conn)
  const hit = state.byJid.get(jid)
  if (hit) {
    if (hit.waiters) {
      hit.waiters.push(onDone)
      return
    }
    onDone(hit.value ?? undefined)
    return
  }
  const entry: AvatarEntry = { value: null, waiters: [onDone] }
  state.byJid.set(jid, entry)
  const finish = (uri: string | null) => {
    const waiters = entry.waiters ?? []
    entry.waiters = undefined
    entry.value = uri
    for (const cb of waiters) cb(uri ?? undefined)
  }

  const advertised = state.hashes.get(jid)
  if (advertised === '') {
    // presence already told us there is no avatar
    finish(null)
    return
  }
  if (advertised) {
    void loadCachedAvatar(advertised).then((cached) => {
      if (cached) finish(cached)
      else fetchWire(conn, state, jid, finish)
    })
    return
  }
  // no hash advertised this session: the persisted jid->hash link may
  // still spare us the vcard query entirely
  void loadJidHash(conn, jid).then(async (hash) => {
    const cached = hash ? await loadCachedAvatar(hash) : null
    if (cached && hash) {
      state.hashes.set(jid, hash)
      finish(cached)
    } else {
      fetchWire(conn, state, jid, finish)
    }
  })
}

// Concurrency-capped wire fetch; everything beyond
// AVATAR_FETCH_CONCURRENCY waits in the queue.
function fetchWire(
  conn: XmppTransport,
  state: AvatarState,
  jid: string,
  finish: (uri: string | null) => void
): void {
  if (state.inFlight >= AVATAR_FETCH_CONCURRENCY) {
    state.queue.push(() => fetchWire(conn, state, jid, finish))
    return
  }
  state.inFlight += 1
  const release = () => {
    state.inFlight -= 1
    state.queue.shift()?.()
  }
  let settled = false
  const done = (uri: string | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    release()
    finish(uri)
  }
  const timer = setTimeout(() => done(null), AVATAR_TIMEOUT_MS)
  conn.sendIq(
    $iq({ type: 'get', to: jid, id: conn.uniqueId('vcard') }).c('vCard', {
      xmlns: NS.VCARD_TEMP
    }),
    (stanza) => {
      const raw = parseVcardPhoto(stanza)
      const photo = raw ? decodePhoto(raw) : null
      if (!photo) {
        done(null)
        return
      }
      persistAvatar(conn, jid, photo.hash, photo.uri)
      done(photo.uri)
    },
    () => done(null)
  )
}
