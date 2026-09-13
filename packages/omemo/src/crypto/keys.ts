// Key generation and Ed25519 to Curve25519 conversions. The omemo:2 profile
// uses Ed25519 identity keys converted to Montgomery form for DH, matching
// XEP-0384. The legacy profile uses raw Curve25519 identity keys.

import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import { CURVE_KEY_SIZE, LEGACY_KEY_TYPE_BYTE, LEGACY_KEY_WIRE_SIZE } from '../constants'
import { ProtocolError } from '../errors'
import { bigIntToBytesLE, bytesEqual, randomBytes } from '../internal/bytes'

export interface KeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

export function generateX25519KeyPair(): KeyPair {
  const privateKey = x25519.utils.randomSecretKey()
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) }
}

export function generateEd25519KeyPair(): KeyPair {
  const privateKey = ed25519.utils.randomSecretKey()
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) }
}

export function clampCurve25519Secret(secret: Uint8Array): Uint8Array {
  if (secret.length !== CURVE_KEY_SIZE) throw new ProtocolError('invalid Curve25519 secret length')
  const clamped = Uint8Array.from(secret)
  clamped[0] = (clamped[0] ?? 0) & 0xf8
  clamped[31] = ((clamped[31] ?? 0) & 0x7f) | 0x40
  return clamped
}

export function generateCurve25519Identity(): KeyPair {
  const privateKey = randomBytes(CURVE_KEY_SIZE)
  return { privateKey, publicKey: x25519.getPublicKey(clampCurve25519Secret(privateKey)) }
}

export function x25519SharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  if (privateKey.length !== CURVE_KEY_SIZE) {
    throw new ProtocolError('invalid Curve25519 secret length')
  }
  if (publicKey.length !== CURVE_KEY_SIZE) {
    throw new ProtocolError('invalid Curve25519 public key length')
  }
  let shared: Uint8Array
  try {
    shared = x25519.getSharedSecret(privateKey, publicKey)
  } catch {
    // noble rejects low order points with a bare Error. Normalize it
    throw new ProtocolError('invalid Curve25519 public key')
  }
  if (bytesEqual(shared, new Uint8Array(CURVE_KEY_SIZE))) {
    throw new ProtocolError('Curve25519 shared secret all zero, low order input')
  }
  return shared
}

// Ed25519 seed to Curve25519 secret, equivalent to libsodium
// crypto_sign_ed25519_sk_to_curve25519 over the 32 byte seed.
export function edSecretToCurveSecret(seed: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomerySecret(seed)
}

// Ed25519 public to Montgomery u coordinate, equivalent to libsodium
// crypto_sign_ed25519_pk_to_curve25519.
export function edPublicToCurvePublic(publicKey: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomery(publicKey)
}

// Montgomery u coordinate back to Edwards y with the given sign bit. Used to
// reconstruct legacy identity keys for XEdDSA verification. Returns the 32
// byte Ed25519 encoding of the point.
export function curvePublicToEdPublic(curvePublicKey: Uint8Array, sign: 0 | 1): Uint8Array {
  if (curvePublicKey.length !== CURVE_KEY_SIZE)
    throw new ProtocolError('invalid Curve25519 key length')
  const Fp = ed25519.Point.Fp
  const u = Fp.create(BigInt('0x' + littleEndianHex(curvePublicKey)))
  const one = Fp.create(1n)
  // Montgomery to Edwards: y = (u - 1) / (u + 1)
  const y = Fp.div(Fp.sub(u, one), Fp.add(u, one))
  const encoded = bigIntToBytesLE(y, CURVE_KEY_SIZE)
  encoded[31] = (encoded[31] ?? 0) | (sign << 7)
  return encoded
}

// Ed25519 sign bit of a raw curve secret. Used to derive the bit that legacy
// signatures smuggle into the top bit of the signature so verifiers can
// reconstruct the Edwards identity key.
export function curveSecretSignBit(privateKey: Uint8Array): 0 | 1 {
  const clamped = clampCurve25519Secret(privateKey)
  // Multiply the Edwards base point by the clamped scalar, the x sign bit of
  // the Edwards encoding is what gets smuggled into signatures.
  const scalar = BigInt('0x' + littleEndianHex(clamped)) % ed25519.Point.Fn.ORDER
  const point = ed25519.Point.BASE.multiply(scalar)
  return ((point.toBytes()[31] ?? 0) >> 7) as 0 | 1
}

export function encodeCurveKeyWire(publicKey: Uint8Array): Uint8Array {
  const out = new Uint8Array(LEGACY_KEY_WIRE_SIZE)
  out[0] = LEGACY_KEY_TYPE_BYTE
  out.set(publicKey, 1)
  return out
}

export function decodeCurveKeyWire(wire: Uint8Array): Uint8Array {
  if (wire.length === CURVE_KEY_SIZE) return wire
  if (wire.length === LEGACY_KEY_WIRE_SIZE && wire[0] === LEGACY_KEY_TYPE_BYTE) {
    return wire.slice(1)
  }
  throw new ProtocolError('invalid legacy Curve25519 key encoding')
}

function littleEndianHex(data: Uint8Array): string {
  let hex = ''
  for (let i = data.length - 1; i >= 0; i--) hex += (data[i] ?? 0).toString(16).padStart(2, '0')
  return hex
}
