// XEdDSA signing over Curve25519 keys for the legacy OMEMO profile. This is an
// independent implementation following the public XEdDSA specification: it
// signs with the clamped Curve25519 scalar interpreted as an Ed25519 scalar and
// smuggles the Edwards sign bit of the identity key into the top bit of the
// signature, so verifiers holding only the Montgomery public key can
// reconstruct the Edwards point.

import { ed25519 } from '@noble/curves/ed25519.js'

import { CURVE_KEY_SIZE, SIGNATURE_SIZE } from '../constants'
import { ProtocolError, InvalidSignatureError } from '../errors'
import { bigIntToBytesLE, bytesToBigIntLE, concatBytes, randomBytes } from '../internal/bytes'
import { sha512 } from './kdf'
import {
  clampCurve25519Secret,
  curvePublicToEdPublic,
  curveSecretSignBit,
  decodeCurveKeyWire
} from './keys'

const L = ed25519.Point.Fn.ORDER

// Hash domain prefix per the XEdDSA spec: 0xFE followed by 31 bytes of 0xFF.
const HASH1_PREFIX = (() => {
  const prefix = new Uint8Array(CURVE_KEY_SIZE)
  prefix[0] = 0xfe
  prefix.fill(0xff, 1)
  return prefix
})()

function scalarOf(data: Uint8Array): bigint {
  return bytesToBigIntLE(data) % L
}

export function xed25519Sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  if (privateKey.length !== CURVE_KEY_SIZE)
    throw new ProtocolError('invalid Curve25519 secret length')
  const clamped = clampCurve25519Secret(privateKey)
  const a = bytesToBigIntLE(clamped)
  // Point multiplication with a mod L yields the same point; noble requires
  // the reduced form.
  const aReduced = a % L
  const A = ed25519.Point.BASE.multiply(aReduced).toBytes()
  const signBit = curveSecretSignBit(privateKey)

  // r = hash1(a || M || Z) mod L where Z is 64 bytes of fresh randomness
  const r = scalarOf(sha512(concatBytes(HASH1_PREFIX, clamped, message, randomBytes(64))))
  const R = ed25519.Point.BASE.multiply(r).toBytes()
  // h = hash(R || A || M) mod L, s = r + h*a mod L
  const h = scalarOf(sha512(concatBytes(R, A, message)))
  const s = (r + h * aReduced) % L

  const signature = new Uint8Array(SIGNATURE_SIZE)
  signature.set(R, 0)
  signature.set(bigIntToBytesLE(s, CURVE_KEY_SIZE), CURVE_KEY_SIZE)
  signature[63] = ((signature[63] ?? 0) & 0x7f) | (signBit << 7)
  return signature
}

export interface XedVerifyResult {
  valid: boolean
  // The reconstructed Edwards identity key including the smuggled sign bit.
  ed25519PublicKey: Uint8Array
}

export function xed25519Verify(
  curvePublicKeyWire: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): XedVerifyResult {
  if (signature.length !== SIGNATURE_SIZE)
    throw new InvalidSignatureError('invalid signature length')
  const signBit = ((signature[63] ?? 0) >> 7) as 0 | 1
  const u = decodeCurveKeyWire(curvePublicKeyWire)
  const ed25519PublicKey = curvePublicToEdPublic(u, signBit)

  const strict = Uint8Array.from(signature)
  strict[63] = (strict[63] ?? 0) & 0x7f
  let valid = false
  try {
    valid = ed25519.verify(strict, message, ed25519PublicKey)
  } catch {
    valid = false
  }
  return { valid, ed25519PublicKey }
}
