// The crypto boundary OmemoService programs against. Two
// implementations exist behind it:
//
// - WorkerOmemoCrypto runs the OmemoManager pair and their IndexedDB
//   stores in a dedicated worker so X3DH, the double ratchet and AES
//   payload work never block the UI thread
// - InlineOmemoCrypto runs the same code in-process. It is the path for
//   callers that inject their own stores (tests, untrusted accounts),
//   for environments without Worker, and as the fallback when spawning
//   a worker fails
//
// Private key material never crosses the boundary: identityKey returns
// the public wire key only.

import type {
  DecryptResult,
  EncryptInput,
  Namespace,
  OmemoStore,
  ParsedBundle,
  XmlElement
} from '@quad4-software/badinage-omemo'

import type { KeyMetaStore } from '../rotation'

import { InlineOmemoCrypto } from './inline'
import { WorkerOmemoCrypto } from './client'

export interface OmemoCrypto {
  readonly deviceId: number
  // false when either profile's store could not wrap key material at
  // rest. Callers should surface this instead of assuming encryption
  readonly secure: boolean
  // why secure is false, for diagnostics
  readonly keyWrapError: unknown

  encrypt(ns: Namespace, input: EncryptInput): Promise<XmlElement>
  decrypt(ns: Namespace, element: XmlElement, senderJid: string): Promise<DecryptResult>
  buildBundle(ns: Namespace): Promise<XmlElement>
  parseBundle(ns: Namespace, element: XmlElement): Promise<ParsedBundle>
  // the public identity wire key, or undefined before init finishes
  identityKey(ns: Namespace): Promise<Uint8Array | undefined>
  getDeviceIds(ns: Namespace, jid: string): Promise<number[] | undefined>
  putDeviceIds(ns: Namespace, jid: string, ids: number[]): Promise<void>
  // signed prekey rotation plus one-time prekey replenishment
  maintain(ns: Namespace): Promise<void>
  // release the worker (or no-op inline). Pending calls reject
  dispose(): void
}

export interface OmemoCryptoOptions {
  accountJid: string
  ownJid: string
  // injected stores select the inline path: a custom store cannot
  // cross postMessage, so these run in-process by design
  omemoStore?: OmemoStore
  legacyStore?: OmemoStore
  metaStore?: KeyMetaStore
}

export async function createOmemoCrypto(options: OmemoCryptoOptions): Promise<OmemoCrypto> {
  const injected = options.omemoStore ?? options.legacyStore ?? options.metaStore
  if (injected !== undefined || typeof Worker === 'undefined') {
    return InlineOmemoCrypto.create(options)
  }
  try {
    return await WorkerOmemoCrypto.create(options)
  } catch (error) {
    // a refused or failed spawn keeps OMEMO working on the main thread
    console.warn(
      'omemo: crypto worker unavailable, running in-process:',
      error instanceof Error ? error.message : String(error)
    )
    return InlineOmemoCrypto.create(options)
  }
}
