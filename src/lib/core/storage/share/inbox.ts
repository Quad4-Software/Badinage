// One-shot inbox for PWA share_target payloads: the service worker
// drops the parsed multipart form here and the app drains it once it
// is up. Plain IndexedDB under the shared kv store so both contexts
// can reach it; entries self-expire on read so a stale share never
// pops up in a later session.
import { SHARE_INBOX_KEY } from '$lib/constants'

import { idb } from '../idb'
import { globalKey } from '../keys'

export interface SharePayload {
  files: File[]
  title: string
  text: string
  url: string
  at: number
}

// a share older than this is dropped instead of resurfacing
const SHARE_TTL_MS = 10 * 60 * 1000

const inboxKey = (): string => globalKey(SHARE_INBOX_KEY)

export function saveShare(payload: SharePayload): Promise<IDBValidKey> {
  return idb.set('kv', inboxKey(), payload)
}

async function peekShare(): Promise<SharePayload | null> {
  const payload = await idb.get<SharePayload | undefined>('kv', inboxKey())
  if (!payload) return null
  if (Date.now() - payload.at > SHARE_TTL_MS) {
    await idb.del('kv', inboxKey())
    return null
  }
  return payload
}

// read-then-delete: the share goes to exactly one consumer
export async function takeShare(): Promise<SharePayload | null> {
  const payload = await peekShare()
  await idb.del('kv', inboxKey())
  return payload
}
