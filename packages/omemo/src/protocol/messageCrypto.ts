// Payload encryption. For omemo:2 the payload is the serialized SCE envelope
// encrypted with AES-256-CBC under keys derived from a random 32 byte key via
// HKDF-SHA-256 (info OMEMO Payload, zero salt, 80 bytes out). The transported
// key material is the 32 byte key plus the 16 byte truncated HMAC appended.
// For the legacy profile the payload is the raw message text encrypted with
// AES-128-GCM and the transported key material is the 16 byte key plus the
// 16 byte GCM tag.

import {
  GCM_IV_SIZE,
  GCM_TAG_SIZE,
  KEY_MATERIAL_SIZE,
  LEGACY_PAYLOAD_KEY_SIZE,
  OMEMO2_MAC_SIZE,
  OMEMO2_PAYLOAD_KEY_SIZE
} from '../constants'
import type { Namespace } from '../constants'
import { ParseError } from '../errors'
import { concatBytes, randomBytes } from '../internal/bytes'
import {
  aes128GcmDecrypt,
  aes128GcmEncrypt,
  aes256CbcDecrypt,
  aes256CbcEncrypt
} from '../crypto/aes'
import { hkdfSha256, hmacSha256 } from '../crypto/kdf'
import type { WireProfile } from './profiles'

export interface Omemo2PayloadResult {
  // 48 bytes: 32 byte payload key || 16 byte authentication tag
  transportKeyMaterial: Uint8Array
  payloadCiphertext: Uint8Array
}

export function encryptPayloadOmemo2(
  profile: WireProfile,
  plaintext: Uint8Array,
  key?: Uint8Array
): Omemo2PayloadResult {
  const keyMaterial = key ?? randomBytes(OMEMO2_PAYLOAD_KEY_SIZE)
  const derived = hkdfSha256(keyMaterial, undefined, profile.infoPayload, KEY_MATERIAL_SIZE)
  const enc = derived.slice(0, 32)
  const auth = derived.slice(32, 64)
  const iv = derived.slice(64, 80)
  const payloadCiphertext = aes256CbcEncrypt(enc, iv, plaintext)
  const tag = hmacSha256(auth, payloadCiphertext).slice(0, OMEMO2_MAC_SIZE)
  return {
    transportKeyMaterial: concatBytes(keyMaterial, tag),
    payloadCiphertext
  }
}

export function decryptPayloadOmemo2(
  profile: WireProfile,
  transportKeyMaterial: Uint8Array,
  payloadCiphertext: Uint8Array
): Uint8Array {
  const expected = OMEMO2_PAYLOAD_KEY_SIZE + OMEMO2_MAC_SIZE
  if (transportKeyMaterial.length !== expected) {
    throw new ParseError(`omemo:2 key material must be ${expected} bytes`)
  }
  const keyMaterial = transportKeyMaterial.slice(0, OMEMO2_PAYLOAD_KEY_SIZE)
  const tag = transportKeyMaterial.slice(OMEMO2_PAYLOAD_KEY_SIZE)
  const derived = hkdfSha256(keyMaterial, undefined, profile.infoPayload, KEY_MATERIAL_SIZE)
  const enc = derived.slice(0, 32)
  const auth = derived.slice(32, 64)
  const iv = derived.slice(64, 80)
  const expectedTag = hmacSha256(auth, payloadCiphertext).slice(0, OMEMO2_MAC_SIZE)
  let diff = 0
  for (let i = 0; i < OMEMO2_MAC_SIZE; i++) diff |= (expectedTag[i] ?? 0) ^ (tag[i] ?? 0)
  if (diff !== 0) throw new ParseError('omemo:2 payload authentication failed')
  return aes256CbcDecrypt(enc, iv, payloadCiphertext)
}

export interface LegacyPayloadResult {
  // 32 bytes: 16 byte AES key || 16 byte GCM tag
  transportKeyMaterial: Uint8Array
  payloadCiphertext: Uint8Array
  iv: Uint8Array
}

export function encryptPayloadLegacy(
  plaintext: Uint8Array,
  key?: Uint8Array,
  iv?: Uint8Array
): LegacyPayloadResult {
  const payloadKey = key ?? randomBytes(LEGACY_PAYLOAD_KEY_SIZE)
  const gcmIv = iv ?? randomBytes(GCM_IV_SIZE)
  const { ciphertext, tag } = aes128GcmEncrypt(payloadKey, gcmIv, plaintext)
  return {
    transportKeyMaterial: concatBytes(payloadKey, tag),
    payloadCiphertext: ciphertext,
    iv: gcmIv
  }
}

export function decryptPayloadLegacy(
  transportKeyMaterial: Uint8Array,
  iv: Uint8Array,
  payloadCiphertext: Uint8Array
): Uint8Array {
  const expected = LEGACY_PAYLOAD_KEY_SIZE + GCM_TAG_SIZE
  if (transportKeyMaterial.length !== expected) {
    throw new ParseError(`legacy key material must be ${expected} bytes`)
  }
  const key = transportKeyMaterial.slice(0, LEGACY_PAYLOAD_KEY_SIZE)
  const tag = transportKeyMaterial.slice(LEGACY_PAYLOAD_KEY_SIZE)
  return aes128GcmDecrypt(key, iv, payloadCiphertext, tag)
}

// Empty messages used for heartbeat and key exchange resends. The transported
// plaintext differs per profile: omemo:2 uses 32 zero bytes (a null key with
// no authentication tag), legacy uses 16 random bytes (a key with no tag).
export function emptyKeyMaterialPlaintext(namespace: Namespace): Uint8Array {
  return namespace === 'omemo2'
    ? new Uint8Array(OMEMO2_PAYLOAD_KEY_SIZE)
    : randomBytes(LEGACY_PAYLOAD_KEY_SIZE)
}
