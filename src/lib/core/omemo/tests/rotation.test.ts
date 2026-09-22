import { describe, expect, it } from 'vitest'

import {
  InMemoryOmemoStore,
  OmemoManager,
  PREKEY_COUNT_DEFAULT,
  PREKEY_COUNT_MIN_LEGACY,
  PREKEY_COUNT_MIN_OMEMO2
} from '@quad4-software/badinage-omemo'

import { maintainKeys, MemoryKeyMetaStore } from './rotation'

async function makeManager(namespace: 'omemo2' | 'legacy' = 'omemo2') {
  const store = new InMemoryOmemoStore()
  const manager = await OmemoManager.create({
    namespace,
    store,
    ownJid: 'me@example.net'
  })
  return { store, manager }
}

describe('maintainKeys', () => {
  it('does nothing to a fresh bundle', async () => {
    const { store, manager } = await makeManager()
    const meta = new MemoryKeyMetaStore()
    const result = await maintainKeys({ store, manager, meta, metaKey: 'omemo2' })
    expect(result).toEqual({ preKeysAdded: 0, signedPreKeyRotated: false })
    expect(await meta.getMeta('omemo2')).toMatchObject({
      publishedPreKeys: PREKEY_COUNT_DEFAULT
    })
  })

  it('tops up one-time prekeys when the store runs below the profile minimum', async () => {
    const { store, manager } = await makeManager()
    // drain most prekeys so only a handful remain
    const ids = await store.listPreKeyIds()
    for (const id of ids.slice(PREKEY_COUNT_MIN_OMEMO2 - 1)) {
      await store.removePreKey(id)
    }
    const remaining = await store.listPreKeyIds()
    expect(remaining.length).toBe(PREKEY_COUNT_MIN_OMEMO2 - 1)

    const meta = new MemoryKeyMetaStore()
    const result = await maintainKeys({ store, manager, meta, metaKey: 'omemo2' })
    expect(result.preKeysAdded).toBe(PREKEY_COUNT_DEFAULT - remaining.length)
    expect((await store.listPreKeyIds()).length).toBe(PREKEY_COUNT_DEFAULT)
  })

  it('uses the lower legacy minimum for the legacy profile', async () => {
    const { store, manager } = await makeManager('legacy')
    const ids = await store.listPreKeyIds()
    // leave exactly the legacy minimum: no top-up expected
    for (const id of ids.slice(PREKEY_COUNT_MIN_LEGACY)) await store.removePreKey(id)
    const meta = new MemoryKeyMetaStore()
    const result = await maintainKeys({ store, manager, meta, metaKey: 'legacy' })
    expect(result.preKeysAdded).toBe(0)
  })

  it('rotates the signed prekey once it is older than the interval', async () => {
    const { store, manager } = await makeManager()
    const now = 1_000_000
    const ids = await store.listSignedPreKeyIds()
    const latest = await store.getSignedPreKey(Math.max(...ids))
    if (!latest) throw new Error('expected a signed prekey')
    // age the current signed prekey beyond the rotation window
    await store.putSignedPreKey({ ...latest, createdAt: now - 1000 })

    const meta = new MemoryKeyMetaStore()
    const result = await maintainKeys({
      store,
      manager,
      meta,
      metaKey: 'omemo2',
      now,
      rotateAfterMs: 500
    })
    expect(result.signedPreKeyRotated).toBe(true)
    const after = await store.listSignedPreKeyIds()
    expect(after.length).toBe(ids.length + 1)
    const fresh = await store.getSignedPreKey(Math.max(...after))
    expect(fresh?.createdAt).toBeGreaterThanOrEqual(0)
  })

  it('keeps a young signed prekey', async () => {
    const { store, manager } = await makeManager()
    const now = 1_000_000
    const ids = await store.listSignedPreKeyIds()
    const latest = await store.getSignedPreKey(Math.max(...ids))
    if (!latest) throw new Error('expected a signed prekey')
    await store.putSignedPreKey({ ...latest, createdAt: now })

    const result = await maintainKeys({
      store,
      manager,
      meta: new MemoryKeyMetaStore(),
      metaKey: 'omemo2',
      now,
      rotateAfterMs: 500
    })
    expect(result.signedPreKeyRotated).toBe(false)
  })
})
