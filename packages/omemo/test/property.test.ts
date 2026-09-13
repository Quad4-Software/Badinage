import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

import { bytesEqual, bytesToHex, hexToBytes, utf8ToBytes } from '../src/internal/bytes'
import {
  aes128GcmDecrypt,
  aes128GcmEncrypt,
  aes256CbcDecrypt,
  aes256CbcEncrypt
} from '../src/crypto/aes'
import { chainMessageKey, hkdfSha256, hmacSha256, sha256 } from '../src/crypto/kdf'
import {
  decodeCurveKeyWire,
  edPublicToCurvePublic,
  edSecretToCurveSecret,
  encodeCurveKeyWire,
  generateCurve25519Identity,
  generateEd25519KeyPair,
  x25519SharedSecret
} from '../src/crypto/keys'
import { xed25519Sign, xed25519Verify } from '../src/crypto/xed25519'
import {
  decodeAuthenticatedMessage,
  decodeBundle,
  decodeKeyExchange,
  decodeOmemoMessage,
  encodeAuthenticatedMessage,
  encodeBundle,
  encodeKeyExchange,
  encodeOmemoMessage
} from '../src/protocol/wire/messages'
import { el, parseXml, serializeXml } from '../src/internal/xml'

const bytes32 = fc.uint8Array({ minLength: 32, maxLength: 32 })
const anyBytes = fc.uint8Array({ minLength: 0, maxLength: 256 })
const varint = fc.integer({ min: 0, max: 0xffffffff })

describe('property: byte helpers', () => {
  it('hex encode/decode round-trips', () => {
    fc.assert(
      fc.property(anyBytes, (data) => {
        expect(bytesEqual(hexToBytes(bytesToHex(data)), data)).toBe(true)
      })
    )
  })
})

describe('property: symmetric crypto round-trips', () => {
  it('aes-256-cbc decrypt(encrypt(m)) = m', () => {
    fc.assert(
      fc.property(
        bytes32,
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        anyBytes,
        (key, iv, pt) => {
          expect(bytesEqual(aes256CbcDecrypt(key, iv, aes256CbcEncrypt(key, iv, pt)), pt)).toBe(
            true
          )
        }
      )
    )
  })

  it('aes-128-gcm decrypt(encrypt(m)) = m and carries a tag', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        fc.uint8Array({ minLength: 12, maxLength: 16 }),
        anyBytes,
        (key, iv, pt) => {
          const { ciphertext, tag } = aes128GcmEncrypt(key, iv, pt)
          expect(tag.length).toBe(16)
          expect(bytesEqual(aes128GcmDecrypt(key, iv, ciphertext, tag), pt)).toBe(true)
        }
      )
    )
  })

  it('aes-128-gcm rejects a tampered tag', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        fc.uint8Array({ minLength: 12, maxLength: 16 }),
        fc.uint8Array({ minLength: 1, maxLength: 128 }),
        fc.integer({ min: 0, max: 15 }),
        (key, iv, pt, byte) => {
          const { ciphertext, tag } = aes128GcmEncrypt(key, iv, pt)
          tag[byte] = (tag[byte] ?? 0) ^ 0xff
          expect(() => aes128GcmDecrypt(key, iv, ciphertext, tag)).toThrow()
        }
      )
    )
  })
})

describe('property: kdf', () => {
  it('hkdf output length is respected', () => {
    fc.assert(
      fc.property(anyBytes, fc.integer({ min: 1, max: 128 }), (ikm, len) => {
        expect(hkdfSha256(ikm, undefined, utf8ToBytes('info'), len).length).toBe(len)
      })
    )
  })

  it('chain message key is deterministic and advances the chain', () => {
    fc.assert(
      fc.property(bytes32, (ck) => {
        const a = chainMessageKey(ck)
        const b = chainMessageKey(ck)
        expect(bytesEqual(a.nextChainKey, b.nextChainKey)).toBe(true)
        expect(bytesEqual(a.messageKey, b.messageKey)).toBe(true)
        expect(bytesEqual(a.nextChainKey, ck)).toBe(false)
      })
    )
  })

  it('hmac and sha256 are deterministic', () => {
    fc.assert(
      fc.property(anyBytes, anyBytes, (key, data) => {
        expect(bytesEqual(hmacSha256(key, data), hmacSha256(key, data))).toBe(true)
        expect(bytesEqual(sha256(data), sha256(data))).toBe(true)
      })
    )
  })
})

describe('property: curve25519', () => {
  it('x25519 shared secrets agree between peers', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const a = generateCurve25519Identity()
        const b = generateCurve25519Identity()
        expect(
          bytesEqual(
            x25519SharedSecret(a.privateKey, b.publicKey),
            x25519SharedSecret(b.privateKey, a.publicKey)
          )
        ).toBe(true)
      }),
      { numRuns: 25 }
    )
  })

  it('curve key wire encoding round-trips', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const kp = generateCurve25519Identity()
        const wire = encodeCurveKeyWire(kp.publicKey)
        expect(wire.length).toBe(33)
        expect(wire[0]).toBe(5)
        expect(bytesEqual(decodeCurveKeyWire(wire), kp.publicKey)).toBe(true)
      }),
      { numRuns: 25 }
    )
  })

  it('ed secret to curve secret then dh matches direct ed to curve public dh', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const ed = generateEd25519KeyPair()
        const x = generateCurve25519Identity()
        const curveSecret = edSecretToCurveSecret(ed.privateKey)
        const curvePub = edPublicToCurvePublic(ed.publicKey)
        expect(
          bytesEqual(
            x25519SharedSecret(curveSecret, x.publicKey),
            x25519SharedSecret(x.privateKey, curvePub)
          )
        ).toBe(true)
      }),
      { numRuns: 25 }
    )
  })
})

describe('property: xeddsa', () => {
  it('sign then verify succeeds for random messages', () => {
    fc.assert(
      fc.property(anyBytes, (msg) => {
        const id = generateCurve25519Identity()
        const sig = xed25519Sign(id.privateKey, msg)
        const result = xed25519Verify(encodeCurveKeyWire(id.publicKey), msg, sig)
        expect(result.valid).toBe(true)
      }),
      { numRuns: 20 }
    )
  })

  it('verification fails on a mutated message', () => {
    fc.assert(
      fc.property(anyBytes, fc.uint8Array({ minLength: 1, maxLength: 64 }), (msg, mutation) => {
        const id = generateCurve25519Identity()
        const sig = xed25519Sign(id.privateKey, msg)
        const tampered = new Uint8Array(msg.length + 1)
        tampered.set(msg)
        tampered[msg.length] = mutation[0] ?? 1
        const result = xed25519Verify(encodeCurveKeyWire(id.publicKey), tampered, sig)
        expect(result.valid).toBe(false)
      }),
      { numRuns: 20 }
    )
  })
})

describe('property: protobuf wire structs', () => {
  it('OMEMOMessage encode/decode round-trips', () => {
    fc.assert(
      fc.property(varint, varint, bytes32, anyBytes, (n, pn, dhPub, ct) => {
        const decoded = decodeOmemoMessage(encodeOmemoMessage({ n, pn, dhPub, ciphertext: ct }))
        expect(decoded.n).toBe(n)
        expect(decoded.pn).toBe(pn)
        expect(bytesEqual(decoded.dhPub, dhPub)).toBe(true)
        expect(bytesEqual(decoded.ciphertext ?? new Uint8Array(0), ct)).toBe(true)
      })
    )
  })

  it('OMEMOAuthenticatedMessage round-trips', () => {
    fc.assert(
      fc.property(anyBytes, anyBytes, (mac, message) => {
        const decoded = decodeAuthenticatedMessage(encodeAuthenticatedMessage({ mac, message }))
        expect(bytesEqual(decoded.mac, mac)).toBe(true)
        expect(bytesEqual(decoded.message, message)).toBe(true)
      })
    )
  })

  it('OMEMOKeyExchange round-trips', () => {
    fc.assert(
      fc.property(varint, varint, bytes32, bytes32, anyBytes, (pkId, spkId, ik, ek, message) => {
        const decoded = decodeKeyExchange(encodeKeyExchange({ pkId, spkId, ik, ek, message }))
        expect(decoded.pkId).toBe(pkId)
        expect(decoded.spkId).toBe(spkId)
        expect(bytesEqual(decoded.ik, ik)).toBe(true)
        expect(bytesEqual(decoded.ek, ek)).toBe(true)
        expect(bytesEqual(decoded.message, message)).toBe(true)
      })
    )
  })

  it('OMEMOBundle round-trips including prekey order', () => {
    fc.assert(
      fc.property(
        varint,
        bytes32,
        fc.uint8Array({ minLength: 64, maxLength: 64 }),
        bytes32,
        fc.array(fc.record({ pkId: varint, pk: bytes32 }), { minLength: 1, maxLength: 8 }),
        (spkId, spk, spkSignature, ik, preKeys) => {
          const decoded = decodeBundle(encodeBundle({ spkId, spk, spkSignature, ik, preKeys }))
          expect(decoded.spkId).toBe(spkId)
          expect(decoded.preKeys.map((p) => p.pkId)).toEqual(preKeys.map((p) => p.pkId))
          for (let i = 0; i < preKeys.length; i++) {
            expect(bytesEqual(decoded.preKeys[i]!.pk, preKeys[i]!.pk)).toBe(true)
          }
        }
      )
    )
  })
})

describe('property: xml', () => {
  it('serialize then parse preserves structure and escapes text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (text) => {
        const tree = el('payload', { xmlns: 'urn:test' }, [], text)
        const parsed = parseXml(serializeXml(tree))
        expect(parsed.name).toBe('payload')
        expect(parsed.attrs['xmlns']).toBe('urn:test')
        expect(parsed.text ?? '').toBe(text)
      })
    )
  })
})
