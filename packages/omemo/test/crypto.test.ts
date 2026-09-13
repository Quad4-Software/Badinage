import { describe, expect, it } from 'vitest'

import { bytesEqual, bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '../src/internal/bytes'
import {
  aes128GcmDecrypt,
  aes128GcmEncrypt,
  aes256CbcDecrypt,
  aes256CbcEncrypt
} from '../src/crypto/aes'
import { chainMessageKey } from '../src/crypto/kdf'
import {
  curvePublicToEdPublic,
  edPublicToCurvePublic,
  edSecretToCurveSecret,
  generateCurve25519Identity,
  generateEd25519KeyPair,
  x25519SharedSecret
} from '../src/crypto/keys'
import { xed25519Sign, xed25519Verify } from '../src/crypto/xed25519'
import { PROFILES } from '../src/protocol/wire/profiles'
import { deriveMessageKeyMaterial } from '../src/protocol/session/session'

import { ed25519 } from '@noble/curves/ed25519.js'

describe('key conversion', () => {
  it('ed25519 to curve25519 matches the RFC 8032 test vector', () => {
    // RFC 8032 TEST 1 secret seed and public key
    const seed = hexToBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60')
    const edPub = ed25519.getPublicKey(seed)
    expect(bytesToHex(edPub)).toBe(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
    )
    // Equivalent of libsodium crypto_sign_ed25519_sk_to_curve25519:
    // sha512(seed)[:32] clamped
    const curveSecret = edSecretToCurveSecret(seed)
    expect(bytesToHex(curveSecret)).toBe(
      '307c83864f2833cb427a2ef1c00a013cfdff2768d980c0a3a520f006904de94f'
    )
    // Equivalent of libsodium crypto_sign_ed25519_pk_to_curve25519:
    // u = (1 + y) / (1 - y)
    const curvePub = edPublicToCurvePublic(edPub)
    expect(bytesToHex(curvePub)).toBe(
      'd85e07ec22b0ad881537c2f44d662d1a143cf830c57aca4305d85c7a90f6b62e'
    )
  })

  it('curve25519 to ed25519 round trips with sign bit', () => {
    const ed = generateEd25519KeyPair()
    const mont = edPublicToCurvePublic(ed.publicKey)
    const sign = ((ed.publicKey[31] ?? 0) >> 7) as 0 | 1
    expect(curvePublicToEdPublic(mont, sign)).toEqual(ed.publicKey)
  })
})

describe('xeddsa', () => {
  it('signs and verifies over a curve25519 identity', () => {
    const identity = generateCurve25519Identity()
    const message = utf8ToBytes('signed pre key material')
    const signature = xed25519Sign(identity.privateKey, message)
    const wire = new Uint8Array(33)
    wire[0] = 0x05
    wire.set(identity.publicKey, 1)
    const { valid, ed25519PublicKey } = xed25519Verify(wire, message, signature)
    expect(valid).toBe(true)
    expect(ed25519PublicKey.length).toBe(32)
  })

  it('rejects a tampered message', () => {
    const identity = generateCurve25519Identity()
    const signature = xed25519Sign(identity.privateKey, utf8ToBytes('a'))
    const wire = new Uint8Array(33)
    wire[0] = 0x05
    wire.set(identity.publicKey, 1)
    const { valid } = xed25519Verify(wire, utf8ToBytes('b'), signature)
    expect(valid).toBe(false)
  })
})

describe('aes', () => {
  it('aes-256-cbc round trips with pkcs7 padding', () => {
    const key = randomBytes(32)
    const iv = randomBytes(16)
    const plaintext = randomBytes(37)
    const ct = aes256CbcEncrypt(key, iv, plaintext)
    expect(aes256CbcDecrypt(key, iv, ct)).toEqual(plaintext)
  })

  it('aes-128-gcm round trips', () => {
    const key = randomBytes(16)
    const iv = randomBytes(12)
    const plaintext = randomBytes(23)
    const { ciphertext, tag } = aes128GcmEncrypt(key, iv, plaintext)
    expect(tag.length).toBe(16)
    expect(aes128GcmDecrypt(key, iv, ciphertext, tag)).toEqual(plaintext)
  })

  it('aes-128-gcm rejects a bad tag', () => {
    const key = randomBytes(16)
    const iv = randomBytes(12)
    const { ciphertext, tag } = aes128GcmEncrypt(key, iv, utf8ToBytes('x'))
    tag[0] = (tag[0] ?? 0) ^ 1
    expect(() => aes128GcmDecrypt(key, iv, ciphertext, tag)).toThrow()
  })
})

// Reference vectors ported from libomemo-c test_ratchet.c (OMEMO version 4,
// the omemo:2 profile). Not from the XEP appendix.
describe('libomemo-c v4 chain key vectors', () => {
  const seed = hexToBytes('8ab72d6f4cc5ac0d387eaf463378ddb28edd07385b1cb01250c715982e7ad48f')
  const expectedMessageKey = hexToBytes(
    '0f6c976863336e89bf7c8c10c18d9fde60b4debd1ff832b863bbb19eeb4c8824'
  )
  const expectedMacKey = hexToBytes(
    '360a0e0a032caa4ff68092a56e90bbe53e81e224e93ffb2d0bb7c0f4c2a01838'
  )
  const expectedNextChainKey = hexToBytes(
    '28e8f8fee54b801eef7c5cfb2f17f32c7b334485bbb70fac6ec10342a246d15d'
  )

  it('derives cipher key, mac key and next chain key', () => {
    const { messageKey, nextChainKey } = chainMessageKey(seed)
    const { enc, auth } = deriveMessageKeyMaterial(PROFILES.omemo2, messageKey)
    expect(bytesToHex(enc)).toBe(bytesToHex(expectedMessageKey))
    expect(bytesToHex(auth)).toBe(bytesToHex(expectedMacKey))
    expect(bytesToHex(nextChainKey)).toBe(bytesToHex(expectedNextChainKey))
  })

  it('second derivation yields counter 1 keys consistently', () => {
    const { nextChainKey } = chainMessageKey(seed)
    const { messageKey } = chainMessageKey(nextChainKey)
    const { enc } = deriveMessageKeyMaterial(PROFILES.omemo2, messageKey)
    expect(enc.length).toBe(32)
  })
})

describe('x25519', () => {
  it('agrees on a shared secret', () => {
    const a = generateCurve25519Identity()
    const b = generateCurve25519Identity()
    expect(
      bytesEqual(
        x25519SharedSecret(a.privateKey, b.publicKey),
        x25519SharedSecret(b.privateKey, a.publicKey)
      )
    ).toBe(true)
  })
})
