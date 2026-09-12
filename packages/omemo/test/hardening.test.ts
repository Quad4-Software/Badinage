// Failure-mode tests: malformed and hostile input must surface as the
// package error classes, never as raw library exceptions, and a failed
// decryption must not corrupt session state.

import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'

import type { Namespace } from '../src/constants'
import {
  AuthenticationError,
  DecryptionFailedError,
  DoSProtectionError,
  DuplicateMessageError,
  InvalidSignatureError,
  MissingPreKeyError,
  OmemoError,
  ParseError,
  ProtocolError
} from '../src/errors'
import { base64Decode, base64Encode, hexToBytes, utf8ToBytes } from '../src/internal/bytes'
import { readFields } from '../src/internal/protobuf'
import { parseXml } from '../src/internal/xml'
import { aes256CbcDecrypt, aes128GcmDecrypt } from '../src/crypto/aes'
import {
  curvePublicToEdPublic,
  decodeCurveKeyWire,
  edPublicToCurvePublic,
  encodeCurveKeyWire,
  generateCurve25519Identity,
  generateEd25519KeyPair,
  generateX25519KeyPair,
  curveSecretSignBit,
  x25519SharedSecret
} from '../src/crypto/keys'
import type { KeyPair } from '../src/crypto/keys'
import { xed25519Sign, xed25519Verify } from '../src/crypto/xed25519'
import { OmemoManager } from '../src/manager'
import { parseBundle, serializeBundle } from '../src/protocol/bundle'
import type { OwnBundle, ParsedBundle } from '../src/protocol/bundle'
import { respondToKeyExchange } from '../src/protocol/deviceKeys'
import { decodeKeyExchangeWire } from '../src/protocol/keyExchange'
import {
  decodeAuthenticatedMessage,
  decodeOmemoMessage,
  encodeOmemoMessage
} from '../src/protocol/messages'
import { marshalMessage, PROFILES } from '../src/protocol/profiles'
import type { Session } from '../src/protocol/session'
import { deserializeSession, serializeSession } from '../src/protocol/sessionData'
import { sessionInitiator, sessionResponder } from '../src/protocol/sessionInit'
import { parseDeviceList, parseEncryptedElement, buildEncryptedElement } from '../src/protocol/wire'
import { x3dhInitiate, x3dhRespond } from '../src/protocol/x3dh'
import type { IdentityMaterial } from '../src/protocol/x3dh'
import { InMemoryOmemoStore } from '../src/store/memory'

function expectOmemoError(fn: () => unknown, cls: new (...args: never[]) => OmemoError): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(OmemoError)
    expect(error).toBeInstanceOf(cls)
    return
  }
  expect.unreachable('expected the call to throw')
}

describe('malformed protobuf input', () => {
  it('truncated varint raises ParseError', () => {
    // tag for field 1 varint, then no value byte
    expectOmemoError(() => readFields(Uint8Array.of(0x08)), ParseError)
  })

  it('truncated length-delimited field raises ParseError', () => {
    // field 1, length 5, only 2 bytes follow
    expectOmemoError(() => readFields(Uint8Array.of(0x0a, 0x05, 0x01, 0x02)), ParseError)
  })

  it('unknown wire type raises ParseError', () => {
    // field 1, wire type 7 is reserved
    expectOmemoError(() => readFields(Uint8Array.of(0x0f, 0x00)), ParseError)
  })

  it('field number zero raises ParseError', () => {
    expectOmemoError(() => readFields(Uint8Array.of(0x00, 0x00)), ParseError)
  })

  it('truncated OMEMOMessage raises ParseError', () => {
    const message = encodeOmemoMessage(
      { n: 1, pn: 0, dhPub: new Uint8Array(32), ciphertext: undefined },
      'omemo2'
    )
    expectOmemoError(() => decodeOmemoMessage(message.slice(0, 4), 'omemo2'), ParseError)
  })

  it('OMEMOAuthenticatedMessage missing fields raises ParseError', () => {
    expectOmemoError(() => decodeAuthenticatedMessage(new Uint8Array(0)), ParseError)
  })
})

describe('key exchange wire input', () => {
  it('legacy message without the version byte raises ParseError', () => {
    expectOmemoError(() => decodeKeyExchangeWire('legacy', Uint8Array.of(0x00, 0x01)), ParseError)
  })

  it('legacy message with a wrong version byte raises ParseError', () => {
    expectOmemoError(() => decodeKeyExchangeWire('legacy', Uint8Array.of(0x34, 0x01)), ParseError)
  })

  it('empty key exchange input raises ParseError', () => {
    expectOmemoError(() => decodeKeyExchangeWire('legacy', new Uint8Array(0)), ParseError)
    expectOmemoError(() => decodeKeyExchangeWire('omemo2', new Uint8Array(0)), ParseError)
  })

  it('truncated key exchange proto raises ParseError', () => {
    expectOmemoError(() => decodeKeyExchangeWire('omemo2', Uint8Array.of(0x08, 0x96)), ParseError)
  })
})

describe('base64 and hex input', () => {
  it('invalid base64 raises ParseError', () => {
    expectOmemoError(() => base64Decode('!!!'), ParseError)
    expectOmemoError(() => base64Decode('AAAA!AAA'), ParseError)
    expectOmemoError(() => base64Decode('A'), ParseError)
  })

  it('invalid hex raises ParseError', () => {
    expectOmemoError(() => hexToBytes('zz'), ParseError)
    expectOmemoError(() => hexToBytes('abc'), ParseError)
  })
})

describe('key material validation', () => {
  it('x25519SharedSecret rejects wrong key lengths', () => {
    const pair = generateX25519KeyPair()
    expectOmemoError(() => x25519SharedSecret(new Uint8Array(31), pair.publicKey), ProtocolError)
    expectOmemoError(() => x25519SharedSecret(pair.privateKey, new Uint8Array(33)), ProtocolError)
  })

  it('x25519SharedSecret rejects low order public keys', () => {
    const pair = generateX25519KeyPair()
    expectOmemoError(() => x25519SharedSecret(pair.privateKey, new Uint8Array(32)), ProtocolError)
  })

  it('decodeCurveKeyWire rejects bad encodings', () => {
    expectOmemoError(() => decodeCurveKeyWire(new Uint8Array(34)), ProtocolError)
    expectOmemoError(() => decodeCurveKeyWire(new Uint8Array(31)), ProtocolError)
    // 33 bytes with the wrong type byte
    const wire = new Uint8Array(33)
    wire[0] = 0x06
    expectOmemoError(() => decodeCurveKeyWire(wire), ProtocolError)
  })

  it('curvePublicToEdPublic rejects bad key lengths', () => {
    expectOmemoError(() => curvePublicToEdPublic(new Uint8Array(16), 0), ProtocolError)
  })

  it('xed25519Verify normalizes malformed input to package errors', () => {
    const ik = generateCurve25519Identity()
    const wire = encodeCurveKeyWire(ik.publicKey)
    expectOmemoError(
      () => xed25519Verify(wire, utf8ToBytes('m'), new Uint8Array(10)),
      InvalidSignatureError
    )
    // a structurally valid but wrong signature just reports invalid
    expect(xed25519Verify(wire, utf8ToBytes('m'), new Uint8Array(64)).valid).toBe(false)
  })
})

describe('wire element parsing', () => {
  it('rejects a non-encrypted element', () => {
    expectOmemoError(() => parseEncryptedElement(parseXml('<foo/>'), 'omemo2'), ParseError)
  })

  it('rejects a missing header', () => {
    expectOmemoError(
      () => parseEncryptedElement(parseXml('<encrypted xmlns="urn:xmpp:omemo:2"/>'), 'omemo2'),
      ParseError
    )
  })

  it('rejects non-numeric sid', () => {
    const xml = '<encrypted xmlns="urn:xmpp:omemo:2"><header sid="abc"/></encrypted>'
    expectOmemoError(() => parseEncryptedElement(parseXml(xml), 'omemo2'), ParseError)
  })

  it('rejects an out of range sid', () => {
    const xml = '<encrypted xmlns="urn:xmpp:omemo:2"><header sid="9999999999"/></encrypted>'
    expectOmemoError(() => parseEncryptedElement(parseXml(xml), 'omemo2'), ParseError)
  })

  it('rejects non-numeric rid on key elements', () => {
    const xml =
      '<encrypted xmlns="eu.siacs.conversations.axolotl">' +
      '<header sid="1"><key rid="x">AAAA</key></header></encrypted>'
    expectOmemoError(() => parseEncryptedElement(parseXml(xml), 'legacy'), ParseError)
  })

  it('rejects malformed base64 in key elements', () => {
    const xml =
      '<encrypted xmlns="eu.siacs.conversations.axolotl">' +
      '<header sid="1"><key rid="2">!!</key></header></encrypted>'
    expectOmemoError(() => parseEncryptedElement(parseXml(xml), 'legacy'), ParseError)
  })

  it('rejects malformed base64 in payload', () => {
    const xml =
      '<encrypted xmlns="urn:xmpp:omemo:2"><header sid="1"/>' + '<payload>%%%</payload></encrypted>'
    expectOmemoError(() => parseEncryptedElement(parseXml(xml), 'omemo2'), ParseError)
  })

  it('parseDeviceList rejects foreign elements and filters bad ids', () => {
    expectOmemoError(() => parseDeviceList(parseXml('<foo/>')), ParseError)
    const list = parseDeviceList(
      parseXml(
        '<list xmlns="eu.siacs.conversations.axolotl"><device id="3"/><device id="x"/></list>'
      )
    )
    expect(list).toEqual([3])
  })
})

interface TestPeer {
  identity: IdentityMaterial
  signedPreKeyId: number
  signedPreKey: KeyPair
  spkSignature: Uint8Array
  preKeyId: number
  preKey: KeyPair
}

function makePeer(namespace: Namespace): TestPeer {
  if (namespace === 'omemo2') {
    const ik = generateEd25519KeyPair()
    const spk = generateX25519KeyPair()
    return {
      identity: {
        privateKey: ik.privateKey,
        publicKey: ik.publicKey,
        wirePublicKey: ik.publicKey
      },
      signedPreKeyId: 0,
      signedPreKey: spk,
      spkSignature: new Uint8Array(64),
      preKeyId: 3,
      preKey: generateX25519KeyPair()
    }
  }
  const ik = generateCurve25519Identity()
  const spk = generateX25519KeyPair()
  return {
    identity: {
      privateKey: ik.privateKey,
      publicKey: ik.publicKey,
      wirePublicKey: encodeCurveKeyWire(ik.publicKey)
    },
    signedPreKeyId: 0,
    signedPreKey: spk,
    spkSignature: xed25519Sign(ik.privateKey, encodeCurveKeyWire(spk.publicKey)),
    preKeyId: 3,
    preKey: generateX25519KeyPair()
  }
}

function peerBundle(namespace: Namespace, peer: TestPeer): ParsedBundle {
  return {
    namespace,
    identityKeyWire: peer.identity.wirePublicKey,
    identityKeyCurve:
      namespace === 'omemo2'
        ? edPublicToCurvePublic(peer.identity.publicKey)
        : peer.identity.publicKey,
    identityKeyEd: peer.identity.publicKey,
    signedPreKeyId: peer.signedPreKeyId,
    signedPreKey: peer.signedPreKey.publicKey,
    signedPreKeySignature: peer.spkSignature,
    preKeys: [{ pkId: peer.preKeyId, pk: peer.preKey.publicKey }]
  }
}

function buildPair(
  namespace: Namespace,
  limits?: { maxSkip: number; maxSkippedKeys: number }
): {
  alice: Session
  bob: Session
  kex: { pkId: number; spkId: number; ik: Uint8Array; ek: Uint8Array }
} {
  const profile = PROFILES[namespace]
  const alice = makePeer(namespace)
  const bob = makePeer(namespace)
  const result = x3dhInitiate(profile, alice.identity, peerBundle(namespace, bob))
  const kex = {
    pkId: result.preKeyId,
    spkId: result.signedPreKeyId,
    ik: alice.identity.wirePublicKey,
    ek:
      namespace === 'legacy'
        ? encodeCurveKeyWire(result.ephemeral.publicKey)
        : result.ephemeral.publicKey
  }
  const aliceSession = sessionInitiator(
    profile,
    {
      sharedSecret: result.sharedSecret,
      associatedData: result.associatedData,
      responderRatchetPublic: result.signedPreKeyPublic,
      localIdentity: alice.identity.wirePublicKey,
      remoteIdentity: bob.identity.wirePublicKey,
      keyExchange: kex
    },
    limits
  )
  const respond = x3dhRespond(profile, bob.identity, {
    ik: kex.ik,
    ek: namespace === 'legacy' ? decodeCurveKeyWire(kex.ek) : kex.ek,
    spkId: kex.spkId,
    pkId: kex.pkId,
    signedPreKey: bob.signedPreKey,
    preKey: bob.preKey
  })
  const bobSession = sessionResponder(
    profile,
    {
      sharedSecret: respond.sharedSecret,
      associatedData: respond.associatedData,
      ownRatchet: respond.signedPreKey,
      localIdentity: bob.identity.wirePublicKey,
      remoteIdentity: respond.remoteIdentityWire,
      keyExchange: kex
    },
    limits
  )
  return { alice: aliceSession, bob: bobSession, kex }
}

describe('session failure modes', () => {
  for (const ns of ['omemo2', 'legacy'] as const) {
    it(`${ns}: tampered message raises AuthenticationError and leaves state intact`, () => {
      const { alice, bob } = buildPair(ns)
      const good = alice.encrypt(utf8ToBytes('one'))
      const tampered = Uint8Array.from(good.wire)
      // corrupt a byte inside the MAC region: omemo:2 keeps the MAC at the
      // start of the authenticated message, legacy appends it at the end
      const at = ns === 'omemo2' ? 4 : tampered.length - 1
      tampered[at] = (tampered[at] ?? 0) ^ 0x01
      expectOmemoError(() => bob.decrypt(tampered), AuthenticationError)
      // the failed attempt must not advance the ratchet: the real message
      // still decrypts afterwards
      expect(bob.decrypt(good.wire)).toEqual(utf8ToBytes('one'))
    })

    it(`${ns}: a replayed message raises DuplicateMessageError`, () => {
      const { alice, bob } = buildPair(ns)
      const m = alice.encrypt(utf8ToBytes('one'))
      bob.decrypt(m.wire)
      expectOmemoError(() => bob.decrypt(m.wire), DuplicateMessageError)
      // state still healthy afterwards
      const m2 = alice.encrypt(utf8ToBytes('two'))
      expect(bob.decrypt(m2.wire)).toEqual(utf8ToBytes('two'))
    })

    it(`${ns}: zero length ciphertext raises a package error`, () => {
      const { bob } = buildPair(ns)
      // handcraft a ratchet message with an empty ciphertext field
      const profile = PROFILES[ns]
      const msg = marshalMessage(
        profile,
        encodeOmemoMessage(
          {
            n: 0,
            pn: 0,
            dhPub: profile.encodeHeaderKey(generateX25519KeyPair().publicKey),
            ciphertext: new Uint8Array(0)
          },
          ns
        )
      )
      const wire = profile.seal(new Uint8Array(profile.macSize), msg)
      expectOmemoError(() => bob.decrypt(wire), OmemoError)
    })

    it(`${ns}: forged low order ratchet key fails without corrupting state`, () => {
      const { alice, bob } = buildPair(ns)
      const profile = PROFILES[ns]
      const msg = marshalMessage(
        profile,
        encodeOmemoMessage(
          {
            n: 0,
            pn: 0,
            dhPub: profile.encodeHeaderKey(new Uint8Array(32)),
            ciphertext: new Uint8Array(16)
          },
          ns
        )
      )
      const wire = profile.seal(new Uint8Array(profile.macSize), msg)
      expectOmemoError(() => bob.decrypt(wire), OmemoError)
      const good = alice.encrypt(utf8ToBytes('after'))
      expect(bob.decrypt(good.wire)).toEqual(utf8ToBytes('after'))
    })

    it(`${ns}: oversized message gap raises DoSProtectionError`, () => {
      const { alice, bob } = buildPair(ns, { maxSkip: 2, maxSkippedKeys: 10 })
      alice.encrypt(utf8ToBytes('m0'))
      alice.encrypt(utf8ToBytes('m1'))
      alice.encrypt(utf8ToBytes('m2'))
      const m3 = alice.encrypt(utf8ToBytes('m3'))
      // delivering only m3 forces a gap of 3 skipped keys, over the limit
      expectOmemoError(() => bob.decrypt(m3.wire), DoSProtectionError)
    })
  }
})

describe('serialized session validation', () => {
  it('rejects an unknown session version', () => {
    const { alice } = buildPair('omemo2')
    const data = { ...serializeSession(alice), v: 2 as unknown as 1 }
    expectOmemoError(() => deserializeSession(data), ParseError)
  })

  it('rejects malformed base64 inside session data', () => {
    const { alice } = buildPair('legacy')
    const data = { ...serializeSession(alice), rk: '!!!' }
    expectOmemoError(() => deserializeSession(data), ParseError)
  })
})

describe('bundle signature verification', () => {
  for (const ns of ['omemo2', 'legacy'] as const) {
    it(`${ns}: a forged signed pre key signature raises InvalidSignatureError`, () => {
      const peer = makePeer(ns)
      const bundle: OwnBundle = {
        namespace: ns,
        deviceId: 1,
        signedPreKeyId: peer.signedPreKeyId,
        signedPreKeyPublic: peer.signedPreKey.publicKey,
        // sign with a different key so the signature does not verify
        signedPreKeySignature:
          ns === 'omemo2'
            ? ed25519.sign(peer.signedPreKey.publicKey, generateEd25519KeyPair().privateKey)
            : xed25519Sign(
                generateCurve25519Identity().privateKey,
                encodeCurveKeyWire(peer.signedPreKey.publicKey)
              ),
        identityKeyWire: peer.identity.wirePublicKey,
        preKeys: [{ pkId: peer.preKeyId, pk: peer.preKey.publicKey }]
      }
      if (ns === 'legacy') {
        bundle.identityKeyCurve = peer.identity.publicKey
        bundle.identityKeyEdSign = curveSecretSignBit(peer.identity.privateKey)
      }
      expectOmemoError(
        () => parseBundle(parseXml(serializeBundle(bundle)), ns),
        InvalidSignatureError
      )
    })
  }
})

describe('responder key exchange failures', () => {
  it('unknown signed pre key id raises MissingPreKeyError', async () => {
    const store = new InMemoryOmemoStore()
    const ik = generateCurve25519Identity()
    await store.putIdentity({
      privateKey: ik.privateKey,
      publicKey: ik.publicKey,
      wirePublicKey: encodeCurveKeyWire(ik.publicKey)
    })
    const kex = {
      pkId: -1,
      spkId: 99,
      ik: encodeCurveKeyWire(generateCurve25519Identity().publicKey),
      ek: generateX25519KeyPair().publicKey,
      message: new Uint8Array(0)
    }
    await expect(
      respondToKeyExchange(store, PROFILES.legacy, kex, { maxSkip: 10, maxSkippedKeys: 10 })
    ).rejects.toBeInstanceOf(MissingPreKeyError)
  })

  it('unknown one-time pre key id raises MissingPreKeyError', async () => {
    const store = new InMemoryOmemoStore()
    const ik = generateCurve25519Identity()
    await store.putIdentity({
      privateKey: ik.privateKey,
      publicKey: ik.publicKey,
      wirePublicKey: encodeCurveKeyWire(ik.publicKey)
    })
    const spk = generateX25519KeyPair()
    await store.putSignedPreKey({ id: 5, pair: spk, signature: new Uint8Array(64), createdAt: 0 })
    const kex = {
      pkId: 77,
      spkId: 5,
      ik: encodeCurveKeyWire(generateCurve25519Identity().publicKey),
      ek: generateX25519KeyPair().publicKey,
      message: new Uint8Array(0)
    }
    await expect(
      respondToKeyExchange(store, PROFILES.legacy, kex, { maxSkip: 10, maxSkippedKeys: 10 })
    ).rejects.toBeInstanceOf(MissingPreKeyError)
  })
})

describe('manager decrypt failures', () => {
  it('message without key material for this device raises DecryptionFailedError', async () => {
    const store = new InMemoryOmemoStore()
    const bob = await OmemoManager.create({
      namespace: 'omemo2',
      store,
      ownJid: 'bob@example.org',
      deviceId: 42,
      preKeyCount: 0
    })
    const element = buildEncryptedElement({
      namespace: 'omemo2',
      sid: 7,
      keys: [{ rid: 43, jid: 'bob@example.org', data: new Uint8Array(8), kex: false }],
      payload: new Uint8Array(8)
    })
    await expect(bob.decrypt(element, 'alice@example.org')).rejects.toBeInstanceOf(
      DecryptionFailedError
    )
  })

  it('non key exchange message without a session raises DecryptionFailedError', async () => {
    const store = new InMemoryOmemoStore()
    const bob = await OmemoManager.create({
      namespace: 'legacy',
      store,
      ownJid: 'bob@example.org',
      deviceId: 42,
      preKeyCount: 0
    })
    const element = buildEncryptedElement({
      namespace: 'legacy',
      sid: 7,
      keys: [{ rid: 42, jid: 'bob@example.org', data: new Uint8Array(24), kex: false }],
      iv: new Uint8Array(16),
      payload: new Uint8Array(8)
    })
    await expect(bob.decrypt(element, 'alice@example.org')).rejects.toBeInstanceOf(
      DecryptionFailedError
    )
  })

  it('legacy element without iv still fails cleanly', async () => {
    const store = new InMemoryOmemoStore()
    const bob = await OmemoManager.create({
      namespace: 'legacy',
      store,
      ownJid: 'bob@example.org',
      deviceId: 42,
      preKeyCount: 0
    })
    const element = buildEncryptedElement({
      namespace: 'legacy',
      sid: 7,
      keys: [{ rid: 42, jid: 'bob@example.org', data: new Uint8Array(24), kex: false }],
      payload: new Uint8Array(8)
    })
    // strip the iv element that buildEncryptedElement always adds
    const header = element.children.find((c) => c.name === 'header')
    if (header) header.children = header.children.filter((c) => c.name !== 'iv')
    await expect(bob.decrypt(element, 'alice@example.org')).rejects.toBeInstanceOf(
      DecryptionFailedError
    )
  })
})

describe('payload cipher failures', () => {
  it('AES-CBC decrypt of malformed input raises DecryptionFailedError', () => {
    const key = new Uint8Array(32)
    const iv = new Uint8Array(16)
    expectOmemoError(() => aes256CbcDecrypt(key, iv, new Uint8Array(3)), DecryptionFailedError)
  })

  it('AES-GCM decrypt with a bad tag raises DecryptionFailedError', () => {
    const key = new Uint8Array(16)
    const iv = new Uint8Array(16)
    expectOmemoError(
      () => aes128GcmDecrypt(key, iv, new Uint8Array(8), new Uint8Array(16)),
      DecryptionFailedError
    )
  })
})

describe('base64 strictness', () => {
  it('round trips and still rejects embedded padding', () => {
    expect(base64Decode(base64Encode(utf8ToBytes('hello world')))).toEqual(
      utf8ToBytes('hello world')
    )
    expectOmemoError(() => base64Decode('A=AA'), ParseError)
  })
})
