// Trust helpers: fingerprints and safety-number-style comparison of identity
// keys. Fingerprints are taken over the Curve25519 form of the identity key,
// which matches the convention used across OMEMO implementations for
// interop between the legacy and omemo:2 profiles.

import { bytesEqual, bytesToHex } from './internal/bytes'
import type { Namespace } from './constants'
import { edPublicToCurvePublic } from './crypto/keys'
import type { ParsedBundle } from './protocol/wire/bundle'

// Extract the 32 byte Curve25519 identity key form from a parsed bundle.
export function identityFingerprintMaterial(bundle: ParsedBundle): Uint8Array {
  return bundle.identityKeyCurve
}

// Fingerprint over a wire encoded identity key.
export function identityFingerprintFromWire(
  namespace: Namespace,
  wireIdentityKey: Uint8Array
): Uint8Array {
  if (namespace === 'omemo2') return edPublicToCurvePublic(wireIdentityKey)
  // Legacy wire form carries the type byte prefix.
  return wireIdentityKey.length === 33 ? wireIdentityKey.slice(1) : wireIdentityKey
}

// 64 hex characters grouped into 8 blocks of 8, the conventional OMEMO
// fingerprint presentation.
export function formatFingerprint(material: Uint8Array): string {
  const hex = bytesToHex(material)
  const groups: string[] = []
  for (let i = 0; i < hex.length; i += 8) groups.push(hex.slice(i, i + 8))
  return groups.join(' ')
}

export function bundleFingerprint(bundle: ParsedBundle): string {
  return formatFingerprint(identityFingerprintMaterial(bundle))
}

// Constant-time comparison of two fingerprints materials, for safety number
// style verification flows.
export function fingerprintsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return bytesEqual(a, b)
}

// A numeric safety code derived from both parties fingerprints, similar in
// spirit to Signal safety numbers. Deterministic and order sensitive: caller
// supplies (local, remote).
export function safetyNumber(local: Uint8Array, remote: Uint8Array): string {
  const combined = new Uint8Array(local.length + remote.length)
  combined.set(local)
  combined.set(remote, local.length)
  const hex = bytesToHex(combined)
  let out = ''
  // Produce 60 digits grouped in 12 blocks of 5 by folding hex pairs.
  for (let i = 0; i < 12; i++) {
    const slice = hex.slice(i * 10, i * 10 + 10)
    const value = BigInt('0x' + slice) % 100000n
    out += value.toString().padStart(5, '0')
    if (i < 11) out += ' '
  }
  return out
}
