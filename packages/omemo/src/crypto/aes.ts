// AES primitives used by the two OMEMO profiles. AES-256-CBC with PKCS7 is
// the XEP-0384 ratchet and payload-key cipher. AES-128-GCM is only used by the
// legacy profile payload encryption.

import { cbc, gcm } from '@noble/ciphers/aes.js'

import { DecryptionFailedError } from '../errors'
import { GCM_TAG_SIZE } from '../constants'

export function aes256CbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array
): Uint8Array {
  return cbc(key, iv).encrypt(plaintext)
}

export function aes256CbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Uint8Array {
  try {
    return cbc(key, iv).decrypt(ciphertext)
  } catch {
    throw new DecryptionFailedError('AES-256-CBC decryption failed')
  }
}

export interface GcmResult {
  ciphertext: Uint8Array
  tag: Uint8Array
}

export function aes128GcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array
): GcmResult {
  const sealed = gcm(key, iv).encrypt(plaintext)
  return {
    ciphertext: sealed.slice(0, sealed.length - GCM_TAG_SIZE),
    tag: sealed.slice(sealed.length - GCM_TAG_SIZE)
  }
}

export function aes128GcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array
): Uint8Array {
  const sealed = new Uint8Array(ciphertext.length + tag.length)
  sealed.set(ciphertext)
  sealed.set(tag, ciphertext.length)
  try {
    return gcm(key, iv).decrypt(sealed)
  } catch {
    throw new DecryptionFailedError('AES-128-GCM decryption failed')
  }
}
