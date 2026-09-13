// Async storage contract for OMEMO key material. Callers are expected to back
// this with IndexedDB or another persistent store. Keys passed to it should
// already be wrapped if at-rest encryption is required (see AGENTS.md: OMEMO
// key material is encrypted at rest). All methods are async so persistence
// layers fit naturally.

import type { KeyPair } from '../crypto/keys'
import type { SessionData } from '../protocol/session/sessionData'

export interface IdentityRecord {
  privateKey: Uint8Array
  publicKey: Uint8Array
  // Wire encoding of the identity key, profile dependent.
  wirePublicKey: Uint8Array
}

export interface SignedPreKeyRecord {
  id: number
  pair: KeyPair
  signature: Uint8Array
  createdAt: number
}

export interface DeviceRecord {
  jid: string
  deviceId: number
  bundle?: unknown
  trusted?: boolean
}

export interface OmemoStore {
  getIdentity(): Promise<IdentityRecord | undefined>
  putIdentity(record: IdentityRecord): Promise<void>

  getSignedPreKey(id: number): Promise<SignedPreKeyRecord | undefined>
  putSignedPreKey(record: SignedPreKeyRecord): Promise<void>
  listSignedPreKeyIds(): Promise<number[]>
  removeSignedPreKey(id: number): Promise<void>

  getPreKey(id: number): Promise<KeyPair | undefined>
  putPreKey(id: number, pair: KeyPair): Promise<void>
  removePreKey(id: number): Promise<void>
  listPreKeyIds(): Promise<number[]>

  // Sessions keyed by bare JID plus device id.
  getSession(jid: string, deviceId: number): Promise<SessionData | undefined>
  putSession(jid: string, deviceId: number, data: SessionData): Promise<void>
  deleteSession(jid: string, deviceId: number): Promise<void>

  // Remembered device lists per bare JID.
  getDeviceIds(jid: string): Promise<number[] | undefined>
  putDeviceIds(jid: string, ids: number[]): Promise<void>
}

export function sessionKey(jid: string, deviceId: number): string {
  return `${jid}/${deviceId}`
}
