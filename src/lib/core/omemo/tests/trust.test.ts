import { describe, expect, it } from 'vitest'

import { InMemoryTrustStore, observeLevel, TrustRegistry } from './trust'
import type { TrustRecord } from './trust'

const record = (over: Partial<TrustRecord> = {}): TrustRecord => ({
  jid: 'romeo@example.net',
  deviceId: 7,
  fingerprint: 'aa',
  level: 'blind',
  changed: false,
  ...over
})

describe('observeLevel', () => {
  it('blind-trusts a first-seen fingerprint when enabled', () => {
    expect(observeLevel(undefined, 'aa', true)).toEqual({ level: 'blind', changed: false })
  })

  it('leaves a first-seen fingerprint undecided when blind trust is off', () => {
    expect(observeLevel(undefined, 'aa', false)).toEqual({ level: 'undecided', changed: false })
  })

  it('keeps the recorded level when the fingerprint is unchanged', () => {
    expect(observeLevel(record({ level: 'trusted' }), 'aa', true)).toEqual({
      level: 'trusted',
      changed: false
    })
    expect(observeLevel(record({ level: 'distrusted' }), 'aa', true)).toEqual({
      level: 'distrusted',
      changed: false
    })
  })

  it('drops to undecided and flags the change on a new fingerprint', () => {
    expect(observeLevel(record({ level: 'trusted' }), 'bb', true)).toEqual({
      level: 'undecided',
      changed: true
    })
  })

  it('keeps the changed flag across repeat observations of the new key', () => {
    const after = record({ fingerprint: 'bb', level: 'undecided', changed: true })
    expect(observeLevel(after, 'bb', true)).toEqual({ level: 'undecided', changed: true })
  })
})

describe('TrustRegistry', () => {
  it('observes, persists and reloads records', async () => {
    const store = new InMemoryTrustStore()
    const registry = new TrustRegistry(store)
    registry.blindTrust = false
    await registry.load()

    const first = await registry.observe('a@b.c', 1, 'ff')
    expect(first.level).toBe('undecided')
    expect(first.changed).toBe(false)

    const fresh = new TrustRegistry(store)
    fresh.blindTrust = false
    await fresh.load()
    expect(fresh.get('a@b.c', 1)).toMatchObject({ level: 'undecided', fingerprint: 'ff' })
  })

  it('flags a key change and recovers through re-verification', async () => {
    const registry = new TrustRegistry(new InMemoryTrustStore())
    await registry.observe('a@b.c', 2, 'aa')
    expect(registry.get('a@b.c', 2)?.level).toBe('blind')

    const changed = await registry.observe('a@b.c', 2, 'bb')
    expect(changed.level).toBe('undecided')
    expect(changed.changed).toBe(true)
    expect(changed.fingerprint).toBe('bb')

    await registry.setLevel('a@b.c', 2, 'trusted')
    const verified = registry.get('a@b.c', 2)
    expect(verified?.level).toBe('trusted')
    // the fingerprint history is still honest: this is not the original key
    expect(verified?.changed).toBe(true)
  })

  it('emits change notifications for observe and setLevel', async () => {
    const registry = new TrustRegistry(new InMemoryTrustStore())
    const seen: TrustRecord[] = []
    registry.events.on('changed', (r) => seen.push(r))
    await registry.observe('a@b.c', 1, 'aa')
    await registry.setLevel('a@b.c', 1, 'distrusted')
    expect(seen.map((r) => r.level)).toEqual(['blind', 'distrusted'])
  })

  it('lists records filtered by jid', async () => {
    const registry = new TrustRegistry(new InMemoryTrustStore())
    await registry.observe('a@b.c', 1, 'aa')
    await registry.observe('a@b.c', 2, 'bb')
    await registry.observe('x@y.z', 1, 'cc')
    expect(registry.list('a@b.c').map((r) => r.deviceId)).toEqual([1, 2])
    expect(registry.list()).toHaveLength(3)
  })

  it('throws when setting a level for an unknown device', async () => {
    const registry = new TrustRegistry(new InMemoryTrustStore())
    await expect(registry.setLevel('a@b.c', 9, 'trusted')).rejects.toThrow()
  })
})
