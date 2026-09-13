// Trust model for OMEMO devices, following the blind-trust-before-
// verification guidance of XEP-0426. A device is identified by the hex
// fingerprint of the identity key its bundle publishes. What we store is
// the fingerprint we believe that device should present plus how much the
// user has confirmed it.

import { Emitter } from '$lib/core/events'

// undecided: seen but never acted on. blind: trusted automatically on
// first use because the blind-trust setting was on. trusted: the user
// verified the fingerprint out of band. distrusted: the user flagged the
// device; it is excluded from encryption.
export type TrustLevel = 'undecided' | 'blind' | 'trusted' | 'distrusted'

export interface TrustRecord {
  jid: string
  deviceId: number
  // hex fingerprint of the identity key currently on file
  fingerprint: string
  level: TrustLevel
  // true once the device presented a different fingerprint than the one
  // first recorded - a key change drops back to undecided until the user
  // re-verifies
  changed: boolean
}

// What a freshly observed fingerprint means for an existing record. Pure
// so the transitions can be unit tested without storage.
//
// XEP-0450 ATM rules: a brand new device lands at blind trust when the
// setting is on. A fingerprint change is always a manual event - a
// rotated key falls back to undecided so the UI can flag the sender as
// untrusted until the user verifies, even when the previous key was
// only blind-trusted.
export function observeLevel(
  existing: TrustRecord | undefined,
  fingerprint: string,
  blindTrust: boolean
): { level: TrustLevel; changed: boolean } {
  if (existing === undefined) {
    return { level: blindTrust ? 'blind' : 'undecided', changed: false }
  }
  if (existing.fingerprint === fingerprint) {
    return { level: existing.level, changed: existing.changed }
  }
  if (existing.level === 'distrusted') return { level: 'distrusted', changed: true }
  return { level: 'undecided', changed: true }
}

// Persistence contract so the registry is testable without IndexedDB.
// The registry caches everything in memory once loaded, so the store only
// needs append-style writes plus a full read at startup.
export interface TrustStore {
  put(record: TrustRecord): Promise<void>
  all(): Promise<TrustRecord[]>
}

export class InMemoryTrustStore implements TrustStore {
  private records = new Map<string, TrustRecord>()

  async put(record: TrustRecord): Promise<void> {
    this.records.set(`${record.jid}/${record.deviceId}`, record)
  }

  async all(): Promise<TrustRecord[]> {
    return [...this.records.values()]
  }
}

export class TrustRegistry {
  blindTrust = true
  readonly events = new Emitter<{ changed: TrustRecord }>()
  private records = new Map<string, TrustRecord>()

  constructor(private readonly store: TrustStore) {}

  private static key(jid: string, deviceId: number): string {
    return `${jid}/${deviceId}`
  }

  async load(): Promise<void> {
    for (const record of await this.store.all()) {
      this.records.set(TrustRegistry.key(record.jid, record.deviceId), record)
    }
  }

  get(jid: string, deviceId: number): TrustRecord | undefined {
    return this.records.get(TrustRegistry.key(jid, deviceId))
  }

  list(jid?: string): TrustRecord[] {
    const all = [...this.records.values()]
    return jid === undefined ? all : all.filter((r) => r.jid === jid)
  }

  // Record a fingerprint seen in the wild. Creates or updates the record
  // following the BTBV rules and persists it. Repeat observations of an
  // unchanged fingerprint are a no-op so listeners do not churn.
  async observe(jid: string, deviceId: number, fingerprint: string): Promise<TrustRecord> {
    const key = TrustRegistry.key(jid, deviceId)
    const existing = this.records.get(key)
    const { level, changed } = observeLevel(existing, fingerprint, this.blindTrust)
    if (
      existing &&
      existing.fingerprint === fingerprint &&
      existing.level === level &&
      existing.changed === changed
    ) {
      return existing
    }
    const record: TrustRecord = { jid, deviceId, fingerprint, level, changed }
    this.records.set(key, record)
    await this.store.put(record)
    this.events.emit('changed', record)
    return record
  }

  async setLevel(jid: string, deviceId: number, level: TrustLevel): Promise<TrustRecord> {
    const existing = this.records.get(TrustRegistry.key(jid, deviceId))
    if (!existing) throw new Error(`no trust record for ${jid}/${deviceId}`)
    const record: TrustRecord = { ...existing, level }
    this.records.set(TrustRegistry.key(jid, deviceId), record)
    await this.store.put(record)
    this.events.emit('changed', record)
    return record
  }
}
