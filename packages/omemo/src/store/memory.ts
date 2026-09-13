// In-memory OmemoStore for tests and ephemeral use. Not persistent; callers
// needing durability should implement OmemoStore over IndexedDB with key
// material wrapped at rest.

import type { KeyPair } from '../crypto/keys'
import type { SessionData } from '../protocol/session/sessionData'
import { sessionKey } from './interface'
import type { IdentityRecord, OmemoStore, SignedPreKeyRecord } from './interface'

export class InMemoryOmemoStore implements OmemoStore {
  private identity: IdentityRecord | undefined
  private readonly signedPreKeys = new Map<number, SignedPreKeyRecord>()
  private readonly preKeys = new Map<number, KeyPair>()
  private readonly sessions = new Map<string, SessionData>()
  private readonly devices = new Map<string, number[]>()

  async getIdentity(): Promise<IdentityRecord | undefined> {
    return this.identity
  }

  async putIdentity(record: IdentityRecord): Promise<void> {
    this.identity = record
  }

  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord | undefined> {
    return this.signedPreKeys.get(id)
  }

  async putSignedPreKey(record: SignedPreKeyRecord): Promise<void> {
    this.signedPreKeys.set(record.id, record)
  }

  async listSignedPreKeyIds(): Promise<number[]> {
    return [...this.signedPreKeys.keys()]
  }

  async removeSignedPreKey(id: number): Promise<void> {
    this.signedPreKeys.delete(id)
  }

  async getPreKey(id: number): Promise<KeyPair | undefined> {
    return this.preKeys.get(id)
  }

  async putPreKey(id: number, pair: KeyPair): Promise<void> {
    this.preKeys.set(id, pair)
  }

  async removePreKey(id: number): Promise<void> {
    this.preKeys.delete(id)
  }

  async listPreKeyIds(): Promise<number[]> {
    return [...this.preKeys.keys()]
  }

  async getSession(jid: string, deviceId: number): Promise<SessionData | undefined> {
    const data = this.sessions.get(sessionKey(jid, deviceId))
    return data === undefined ? undefined : structuredClone(data)
  }

  async putSession(jid: string, deviceId: number, data: SessionData): Promise<void> {
    this.sessions.set(sessionKey(jid, deviceId), structuredClone(data))
  }

  async deleteSession(jid: string, deviceId: number): Promise<void> {
    this.sessions.delete(sessionKey(jid, deviceId))
  }

  async getDeviceIds(jid: string): Promise<number[] | undefined> {
    return this.devices.get(jid)
  }

  async putDeviceIds(jid: string, ids: number[]): Promise<void> {
    this.devices.set(jid, [...ids])
  }
}
