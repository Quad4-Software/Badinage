// Wire protocol between the main thread and the OMEMO worker. Every
// payload is structured-cloneable: XmlElement trees, ParsedBundle
// records and Uint8Array key material cross as copies, so neither side
// can mutate the other's objects.
//
// One worker owns both OmemoManager instances plus their IndexedDB
// stores. All calls run through a strict FIFO inside the worker so
// ratchet and prekey mutations never interleave at await points. That
// is stricter than the old in-process path, where concurrent decrypt
// calls could race session load/save.

import {
  AuthenticationError,
  DecryptionFailedError,
  DoSProtectionError,
  DuplicateMessageError,
  InvalidSignatureError,
  KeyExchangeError,
  MissingPreKeyError,
  OmemoError,
  ParseError,
  ProtocolError
} from '@quad4-software/badinage-omemo'
import type { EncryptInput, Namespace, XmlElement } from '@quad4-software/badinage-omemo'

// a single crypto call may legitimately take a while when it walks a
// long device list, but a wedged worker must not hang callers forever.
// On expiry the worker is killed outright: a call that timed out may
// have half-mutated ratchet state, so it cannot be trusted to continue
export const OMEMO_CALL_TIMEOUT_MS = 30_000

export type CryptoOp =
  | 'init'
  | 'encrypt'
  | 'decrypt'
  | 'buildBundle'
  | 'parseBundle'
  | 'identityKey'
  | 'getDeviceIds'
  | 'putDeviceIds'
  | 'maintain'

// one optional bag keeps the wire shape flat and version tolerant
export interface CryptoArgs {
  accountJid?: string
  ownJid?: string
  ns?: Namespace
  input?: EncryptInput
  element?: XmlElement
  senderJid?: string
  jid?: string
  ids?: number[]
}

export interface CryptoRequest {
  id: number
  op: CryptoOp
  args: CryptoArgs
}

export type CryptoResponse =
  { id: number; ok: true; value: unknown } | { id: number; ok: false; error: WireError }

export interface WireError {
  name: string
  message: string
}

export interface InitResult {
  deviceId: number
  // false when key material could not be wrapped at rest. The caller
  // surfaces this instead of assuming encryption
  secure: boolean
  keyWrapError?: string
}

export function packError(error: unknown): WireError {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}

// Rebuild the matching error class on the main side so instanceof
// checks (DuplicateMessageError in decryptInto) keep working across
// the boundary. Unknown names degrade to a plain Error that still
// carries the original name.
const ERROR_CLASSES: Record<string, new (message: string) => Error> = {
  OmemoError,
  ProtocolError,
  DecryptionFailedError,
  AuthenticationError,
  KeyExchangeError,
  InvalidSignatureError,
  MissingPreKeyError,
  DoSProtectionError,
  DuplicateMessageError,
  ParseError
}

export function unpackError(wire: WireError): Error {
  const cls = ERROR_CLASSES[wire.name]
  if (cls) return new cls(wire.message)
  const error = new Error(wire.message)
  error.name = wire.name
  return error
}

// the worker surface install() programs against, shaped so tests can
// drive the real dispatch loop with a fake scope
export interface WorkerScope {
  onmessage: ((event: { data: CryptoRequest }) => void) | null
  postMessage(response: CryptoResponse): void
}
