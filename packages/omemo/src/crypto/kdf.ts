// Hash, HMAC and HKDF helpers shared by the protocol layers.

import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'

import { HKDF_SALT_SIZE, CHAIN_CONSTANT_MESSAGE, CHAIN_CONSTANT_CHAIN } from '../constants'

export { sha256, sha512 }

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data)
}

export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array | undefined,
  info: Uint8Array,
  length: number
): Uint8Array {
  const effectiveSalt = salt ?? new Uint8Array(HKDF_SALT_SIZE)
  return hkdf(sha256, ikm, effectiveSalt, info, length)
}

// Symmetric message chain step shared by the X3DH root KDF and the Double
// Ratchet: one HMAC produces the next chain key, the other the message key.
export function chainMessageKey(chainKey: Uint8Array): {
  nextChainKey: Uint8Array
  messageKey: Uint8Array
} {
  return {
    messageKey: hmacSha256(chainKey, Uint8Array.of(CHAIN_CONSTANT_MESSAGE)),
    nextChainKey: hmacSha256(chainKey, Uint8Array.of(CHAIN_CONSTANT_CHAIN))
  }
}
