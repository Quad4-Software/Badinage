// Key material maintenance for OMEMO: one-time prekey top-up and signed
// prekey rotation. The omemo package deliberately never deletes consumed
// prekeys (XEP-0384 recommends keeping them until message catch-up
// completes) and exposes no consumption hooks, so the app tracks how many
// prekeys the last published bundle carried; if the stored count ever
// drops below the profile minimum - for example because a future package
// version or a manual wipe removes them - the bundle is topped back up
// and republished. Signed prekeys rotate on an age interval; old signed
// prekeys stay in the store so delayed key exchanges still resolve.

import { OMEMO_SPK_ROTATE_MS } from '$lib/constants'

import {
  generateX25519KeyPair,
  PREKEY_COUNT_DEFAULT,
  PREKEY_COUNT_MIN_LEGACY,
  PREKEY_COUNT_MIN_OMEMO2
} from '@quad4-software/omemo'
import type { Namespace, OmemoManager, OmemoStore } from '@quad4-software/omemo'

// What the service persists between sessions to know what the published
// bundle contained.
export interface KeyMeta {
  // one-time prekey count in the last published bundle
  publishedPreKeys: number
  // when the current signed prekey was generated
  signedPreKeyAt: number
}

// Small persistence contract so rotation state survives reloads. The
// IndexedDB store implements it; tests get the in-memory variant.
export interface KeyMetaStore {
  getMeta(key: string): Promise<KeyMeta | undefined>
  putMeta(key: string, meta: KeyMeta): Promise<void>
}

export class MemoryKeyMetaStore implements KeyMetaStore {
  private readonly records = new Map<string, KeyMeta>()

  async getMeta(key: string): Promise<KeyMeta | undefined> {
    return this.records.get(key)
  }

  async putMeta(key: string, meta: KeyMeta): Promise<void> {
    this.records.set(key, meta)
  }
}

export interface MaintainResult {
  preKeysAdded: number
  signedPreKeyRotated: boolean
}

function minPreKeys(namespace: Namespace): number {
  return namespace === 'legacy' ? PREKEY_COUNT_MIN_LEGACY : PREKEY_COUNT_MIN_OMEMO2
}

// Inspect stored key material and fix whatever is low or stale. Safe to
// run on every reconnect; the caller republishes the bundle afterwards.
export async function maintainKeys(opts: {
  store: OmemoStore
  manager: OmemoManager
  meta: KeyMetaStore
  metaKey: string
  now?: number
  rotateAfterMs?: number
}): Promise<MaintainResult> {
  const { store, manager, meta, metaKey } = opts
  const now = opts.now ?? Date.now()
  const rotateAfter = opts.rotateAfterMs ?? OMEMO_SPK_ROTATE_MS
  const result: MaintainResult = { preKeysAdded: 0, signedPreKeyRotated: false }
  const state = (await meta.getMeta(metaKey)) ?? { publishedPreKeys: 0, signedPreKeyAt: 0 }

  const spkIds = await store.listSignedPreKeyIds()
  const latestId = spkIds.length > 0 ? Math.max(...spkIds) : undefined
  const latest = latestId === undefined ? undefined : await store.getSignedPreKey(latestId)
  if (latest === undefined || now - latest.createdAt > rotateAfter) {
    await manager.rotateSignedPreKey((latestId ?? 0) + 1)
    result.signedPreKeyRotated = true
    state.signedPreKeyAt = now
  }

  const stored = await store.listPreKeyIds()
  if (stored.length < minPreKeys(manager.namespace)) {
    const next = (stored.length > 0 ? Math.max(...stored) : -1) + 1
    for (let i = 0; i < PREKEY_COUNT_DEFAULT - stored.length; i++) {
      await store.putPreKey(next + i, generateX25519KeyPair())
    }
    result.preKeysAdded = PREKEY_COUNT_DEFAULT - stored.length
  }
  state.publishedPreKeys = stored.length + result.preKeysAdded
  await meta.putMeta(metaKey, state)
  return result
}
