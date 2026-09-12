import { describe, expect, it } from 'vitest'

import { bytesEqual, hexToBytes, randomBytes, utf8ToBytes } from '../src/internal/bytes'
import { el, parseXml } from '../src/internal/xml'
import {
  curveSecretSignBit,
  encodeCurveKeyWire,
  generateCurve25519Identity,
  generateEd25519KeyPair,
  generateX25519KeyPair
} from '../src/crypto/keys'
import { xed25519Sign } from '../src/crypto/xed25519'
import { ed25519 } from '@noble/curves/ed25519.js'
import { parseBundle, serializeBundle } from '../src/protocol/bundle'
import type { OwnBundle } from '../src/protocol/bundle'
import {
  decryptPayloadLegacy,
  decryptPayloadOmemo2,
  encryptPayloadLegacy,
  encryptPayloadOmemo2
} from '../src/protocol/messageCrypto'
import { PROFILES } from '../src/protocol/profiles'
import {
  bodyText,
  buildSceEnvelope,
  parseSceEnvelope,
  serializeSceEnvelope,
  textEnvelope
} from '../src/protocol/sce'
import {
  buildEncryptedElement,
  parseDeviceList,
  parseEncryptedElement,
  serializeDeviceList,
  serializeEncrypted
} from '../src/protocol/wire'

describe('bundle', () => {
  it('omemo2 bundle round trips and verifies', () => {
    const ik = generateEd25519KeyPair()
    const spk = generateX25519KeyPair()
    const signature = ed25519.sign(spk.publicKey, ik.privateKey)
    const preKey = generateX25519KeyPair()
    const bundle: OwnBundle = {
      namespace: 'omemo2',
      deviceId: 7,
      signedPreKeyId: 0,
      signedPreKeyPublic: spk.publicKey,
      signedPreKeySignature: signature,
      identityKeyWire: ik.publicKey,
      preKeys: [{ pkId: 1, pk: preKey.publicKey }]
    }
    const parsed = parseBundle(parseXml(serializeBundle(bundle)), 'omemo2')
    expect(parsed.identityKeyWire).toEqual(ik.publicKey)
    expect(parsed.signedPreKey).toEqual(spk.publicKey)
    expect(parsed.preKeys[0]?.pkId).toBe(1)
  })

  it('omemo2 bundle rejects a bad signature', () => {
    const ik = generateEd25519KeyPair()
    const other = generateEd25519KeyPair()
    const spk = generateX25519KeyPair()
    const signature = ed25519.sign(spk.publicKey, other.privateKey)
    const bundle: OwnBundle = {
      namespace: 'omemo2',
      deviceId: 7,
      signedPreKeyId: 0,
      signedPreKeyPublic: spk.publicKey,
      signedPreKeySignature: signature,
      identityKeyWire: ik.publicKey,
      preKeys: []
    }
    expect(() => parseBundle(parseXml(serializeBundle(bundle)), 'omemo2')).toThrow()
  })

  it('legacy bundle round trips and verifies', () => {
    const ik = generateCurve25519Identity()
    const spk = generateX25519KeyPair()
    const signature = xed25519Sign(ik.privateKey, encodeCurveKeyWire(spk.publicKey))
    const preKey = generateX25519KeyPair()
    const bundle: OwnBundle = {
      namespace: 'legacy',
      deviceId: 7,
      signedPreKeyId: 0,
      signedPreKeyPublic: spk.publicKey,
      signedPreKeySignature: signature,
      identityKeyWire: encodeCurveKeyWire(ik.publicKey),
      identityKeyCurve: ik.publicKey,
      identityKeyEdSign: curveSecretSignBit(ik.privateKey),
      preKeys: [{ pkId: 1, pk: preKey.publicKey }]
    }
    const parsed = parseBundle(parseXml(serializeBundle(bundle)), 'legacy')
    expect(parsed.identityKeyWire).toEqual(encodeCurveKeyWire(ik.publicKey))
    expect(parsed.signedPreKey).toEqual(spk.publicKey)
    expect(parsed.identityKeyEd.length).toBe(32)
    // The reconstructed ed key sign matches the true sign bit
    expect((parsed.identityKeyEd[31] ?? 0) >> 7).toBe(curveSecretSignBit(ik.privateKey))
  })
})

describe('payload crypto', () => {
  it('omemo2 payload round trips', () => {
    const plaintext = utf8ToBytes('<envelope/>')
    const { transportKeyMaterial, payloadCiphertext } = encryptPayloadOmemo2(
      PROFILES.omemo2,
      plaintext
    )
    expect(transportKeyMaterial.length).toBe(48)
    expect(decryptPayloadOmemo2(PROFILES.omemo2, transportKeyMaterial, payloadCiphertext)).toEqual(
      plaintext
    )
  })

  it('omemo2 rejects a bad auth tag', () => {
    const { transportKeyMaterial, payloadCiphertext } = encryptPayloadOmemo2(
      PROFILES.omemo2,
      utf8ToBytes('x')
    )
    transportKeyMaterial[47] = (transportKeyMaterial[47] ?? 0) ^ 1
    expect(() =>
      decryptPayloadOmemo2(PROFILES.omemo2, transportKeyMaterial, payloadCiphertext)
    ).toThrow()
  })

  it('legacy payload round trips with key||tag material', () => {
    const plaintext = utf8ToBytes('hello legacy')
    const { transportKeyMaterial, payloadCiphertext, iv } = encryptPayloadLegacy(plaintext)
    expect(transportKeyMaterial.length).toBe(32)
    expect(iv.length).toBe(12)
    expect(decryptPayloadLegacy(transportKeyMaterial, iv, payloadCiphertext)).toEqual(plaintext)
  })
})

describe('sce envelope', () => {
  it('builds and parses an envelope', () => {
    const xml = serializeSceEnvelope({
      ...textEnvelope('hello'),
      from: 'alice@example.org',
      to: 'bob@example.org',
      time: new Date('2024-01-02T03:04:05.000Z')
    })
    const parsed = parseSceEnvelope(parseXml(xml))
    expect(parsed.from).toBe('alice@example.org')
    expect(parsed.to).toBe('bob@example.org')
    expect(parsed.time?.toISOString()).toBe('2024-01-02T03:04:05.000Z')
    expect(bodyText(parsed)).toBe('hello')
  })

  it('envelope root carries the sce namespace', () => {
    const envelope = buildSceEnvelope({ content: [] })
    expect(envelope.attrs['xmlns']).toBe('urn:xmpp:sce:1')
  })
})

describe('wire elements', () => {
  it('omemo2 encrypted element round trips', () => {
    const element = buildEncryptedElement({
      namespace: 'omemo2',
      sid: 5,
      keys: [
        { rid: 1, jid: 'bob@example.org', data: randomBytes(40), kex: true },
        { rid: 2, jid: 'bob@example.org', data: randomBytes(40), kex: false }
      ],
      payload: randomBytes(64)
    })
    const parsed = parseEncryptedElement(parseXml(serializeEncrypted(element)), 'omemo2')
    expect(parsed.sid).toBe(5)
    expect(parsed.keys.length).toBe(2)
    expect(parsed.keys[0]?.kex).toBe(true)
    expect(parsed.keys[1]?.kex).toBe(false)
    expect(parsed.keys[0]?.jid).toBe('bob@example.org')
  })

  it('legacy encrypted element round trips', () => {
    const element = buildEncryptedElement({
      namespace: 'legacy',
      sid: 9,
      keys: [{ rid: 3, jid: 'x@y', data: randomBytes(60), kex: true }],
      payload: randomBytes(32),
      iv: randomBytes(12)
    })
    const parsed = parseEncryptedElement(parseXml(serializeEncrypted(element)), 'legacy')
    expect(parsed.sid).toBe(9)
    expect(parsed.keys[0]?.kex).toBe(true)
    expect(parsed.iv?.length).toBe(12)
    expect(parsed.payload?.length).toBe(32)
  })

  it('device lists round trip both profiles', () => {
    const o2 = parseXml(serializeDeviceList('omemo2', [1, 42]))
    const lg = parseXml(serializeDeviceList('legacy', [1, 42]))
    expect(o2.name).toBe('devices')
    expect(lg.name).toBe('list')
    expect(parseDeviceList(o2)).toEqual([1, 42])
    expect(parseDeviceList(lg)).toEqual([1, 42])
  })
})
