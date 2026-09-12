// X3DH key agreement per XEP-0384. The shared secret is
// HKDF-SHA-256(salt = 32 zero bytes, ikm = 0xFF*32 || DH1 || DH2 || DH3 || DH4,
// info = profile string, 32 bytes). Associated data is the wire encoding of
// the initiator identity key followed by the responder identity key.

import { CURVE_KEY_SIZE, X3DH_PAD_BYTE, X3DH_PAD_SIZE } from '../constants'
import { MissingPreKeyError } from '../errors'
import { concatBytes } from '../internal/bytes'
import { hkdfSha256 } from '../crypto/kdf'
import {
  clampCurve25519Secret,
  edPublicToCurvePublic,
  edSecretToCurveSecret,
  generateX25519KeyPair,
  x25519SharedSecret
} from '../crypto/keys'
import type { KeyPair } from '../crypto/keys'
import type { ParsedBundle } from './bundle'
import type { WireProfile } from './profiles'

export interface IdentityMaterial {
  // Profile native private key: Ed25519 seed for omemo:2, raw Curve25519
  // secret for the legacy profile.
  privateKey: Uint8Array
  // Profile native public key: Ed25519 or Curve25519, 32 bytes.
  publicKey: Uint8Array
  // The wire encoding used inside associated data and key exchange messages:
  // 32 bytes for omemo:2, 33 bytes (type byte prefix) for legacy.
  wirePublicKey: Uint8Array
}

export interface X3dhActiveResult {
  sharedSecret: Uint8Array
  associatedData: Uint8Array
  ephemeral: KeyPair
  signedPreKeyId: number
  signedPreKeyPublic: Uint8Array
  preKeyId: number
  preKeyPublic: Uint8Array | undefined
}

export interface X3dhPassiveInput {
  ik: Uint8Array
  ek: Uint8Array
  spkId: number
  pkId: number
  signedPreKey: KeyPair
  preKey: KeyPair | undefined
}

export interface X3dhPassiveResult {
  sharedSecret: Uint8Array
  associatedData: Uint8Array
  // The signed pre key pair the peer selected. Its private key seeds the
  // responder side Double Ratchet.
  signedPreKey: KeyPair
  remoteIdentityWire: Uint8Array
}

function identityCurveSecret(profile: WireProfile, identity: IdentityMaterial): Uint8Array {
  return profile.namespace === 'omemo2'
    ? edSecretToCurveSecret(identity.privateKey)
    : clampCurve25519Secret(identity.privateKey)
}

function peerCurvePublic(profile: WireProfile, wirePublicKey: Uint8Array): Uint8Array {
  if (profile.namespace === 'omemo2') {
    return edPublicToCurvePublic(wirePublicKey)
  }
  return wirePublicKey.length === CURVE_KEY_SIZE ? wirePublicKey : wirePublicKey.slice(1)
}

// peerCurveFromWire accepts the wire encoded identity key: 32 byte Ed25519
// key for omemo:2, 33 byte serialized Curve25519 key for legacy.

export function x3dhInitiate(
  profile: WireProfile,
  own: IdentityMaterial,
  bundle: ParsedBundle,
  options: { requirePreKey?: boolean; random?: () => number } = {}
): X3dhActiveResult {
  const ikSecret = identityCurveSecret(profile, own)
  const theirIk = peerCurvePublic(profile, bundle.identityKeyWire)
  const ekp = generateX25519KeyPair()

  let preKey: { pkId: number; pk: Uint8Array } | undefined
  if (bundle.preKeys.length > 0) {
    const index = Math.floor((options.random ?? Math.random)() * bundle.preKeys.length)
    preKey = bundle.preKeys[index]
  } else if (options.requirePreKey) {
    throw new MissingPreKeyError('bundle contains no one-time prekeys')
  }

  const dh1 = x25519SharedSecret(ikSecret, bundle.signedPreKey)
  const dh2 = x25519SharedSecret(ekp.privateKey, theirIk)
  const dh3 = x25519SharedSecret(ekp.privateKey, bundle.signedPreKey)
  const dh4 = preKey ? x25519SharedSecret(ekp.privateKey, preKey.pk) : new Uint8Array(0)

  const sharedSecret = kdfX3dh(profile, dh1, dh2, dh3, dh4)
  const associatedData = concatBytes(own.wirePublicKey, bundle.identityKeyWire)

  return {
    sharedSecret,
    associatedData,
    ephemeral: ekp,
    signedPreKeyId: bundle.signedPreKeyId,
    signedPreKeyPublic: bundle.signedPreKey,
    preKeyId: preKey?.pkId ?? -1,
    preKeyPublic: preKey?.pk
  }
}

export function x3dhRespond(
  profile: WireProfile,
  own: IdentityMaterial,
  input: X3dhPassiveInput
): X3dhPassiveResult {
  const ikSecret = identityCurveSecret(profile, own)
  const theirIk = peerCurvePublic(profile, input.ik)

  const dh1 = x25519SharedSecret(input.signedPreKey.privateKey, theirIk)
  const dh2 = x25519SharedSecret(ikSecret, input.ek)
  const dh3 = x25519SharedSecret(input.signedPreKey.privateKey, input.ek)
  const dh4 = input.preKey
    ? x25519SharedSecret(input.preKey.privateKey, input.ek)
    : new Uint8Array(0)

  const sharedSecret = kdfX3dh(profile, dh1, dh2, dh3, dh4)
  const associatedData = concatBytes(input.ik, own.wirePublicKey)

  return {
    sharedSecret,
    associatedData,
    signedPreKey: input.signedPreKey,
    remoteIdentityWire: input.ik
  }
}

function kdfX3dh(
  profile: WireProfile,
  dh1: Uint8Array,
  dh2: Uint8Array,
  dh3: Uint8Array,
  dh4: Uint8Array
): Uint8Array {
  const padding = new Uint8Array(X3DH_PAD_SIZE).fill(X3DH_PAD_BYTE)
  const ikm = concatBytes(padding, dh1, dh2, dh3, dh4)
  return hkdfSha256(ikm, undefined, profile.infoX3dh, CURVE_KEY_SIZE)
}
