import { describe, expect, it } from 'vitest'

import type { Namespace } from '../src/constants'
import { bytesEqual, hexToBytes, utf8ToBytes } from '../src/internal/bytes'
import {
  encodeCurveKeyWire,
  generateCurve25519Identity,
  generateEd25519KeyPair,
  generateX25519KeyPair,
  edPublicToCurvePublic,
  curveSecretSignBit
} from '../src/crypto/keys'
import type { KeyPair } from '../src/crypto/keys'
import { xed25519Sign } from '../src/crypto/xed25519'
import type { ParsedBundle } from '../src/protocol/wire/bundle'
import { PROFILES } from '../src/protocol/wire/profiles'
import type { Session } from '../src/protocol/session/session'
import { sessionInitiator, sessionResponder } from '../src/protocol/session/sessionInit'
import { x3dhInitiate, x3dhRespond } from '../src/protocol/session/x3dh'
import type { IdentityMaterial } from '../src/protocol/session/x3dh'
import { encodeKeyExchangeWire, decodeKeyExchangeWire } from '../src/protocol/wire/keyExchange'
import { serializeSession, deserializeSession } from '../src/protocol/session/sessionData'

interface TestPeer {
  identity: IdentityMaterial
  signBit: 0 | 1
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
      signBit: 0,
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
    signBit: curveSecretSignBit(ik.privateKey),
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
    identityKeyEd: namespace === 'omemo2' ? peer.identity.publicKey : peer.identity.publicKey,
    signedPreKeyId: peer.signedPreKeyId,
    signedPreKey: peer.signedPreKey.publicKey,
    signedPreKeySignature: peer.spkSignature,
    preKeys: [{ pkId: peer.preKeyId, pk: peer.preKey.publicKey }]
  }
}

interface PairedSessions {
  alice: Session
  bob: Session
}

function buildPair(namespace: Namespace): PairedSessions {
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

  const aliceSession = sessionInitiator(profile, {
    sharedSecret: result.sharedSecret,
    associatedData: result.associatedData,
    responderRatchetPublic: result.signedPreKeyPublic,
    localIdentity: alice.identity.wirePublicKey,
    remoteIdentity: bob.identity.wirePublicKey,
    keyExchange: kex
  })

  const wireKex = decodeKeyExchangeWire(
    namespace,
    encodeKeyExchangeWire(namespace, kex, utf8ToBytes('placeholder'))
  )
  const respond = x3dhRespond(profile, bob.identity, {
    ik: wireKex.ik,
    ek: wireKex.ek,
    spkId: wireKex.spkId,
    pkId: wireKex.pkId,
    signedPreKey: bob.signedPreKey,
    preKey: bob.preKey
  })
  expect(bytesEqual(respond.sharedSecret, result.sharedSecret)).toBe(true)
  expect(bytesEqual(respond.associatedData, result.associatedData)).toBe(true)

  const bobSession = sessionResponder(profile, {
    sharedSecret: respond.sharedSecret,
    associatedData: respond.associatedData,
    ownRatchet: respond.signedPreKey,
    localIdentity: bob.identity.wirePublicKey,
    remoteIdentity: respond.remoteIdentityWire
  })

  return { alice: aliceSession, bob: bobSession }
}

for (const namespace of ['omemo2', 'legacy'] as const) {
  describe(`ratchet ping-pong (${namespace})`, () => {
    it('alice and bob exchange messages', () => {
      const { alice, bob } = buildPair(namespace)
      const m1 = alice.encrypt(utf8ToBytes('hello bob'))
      expect(bob.decrypt(m1.wire)).toEqual(utf8ToBytes('hello bob'))
      const r1 = bob.encrypt(utf8ToBytes('hi alice'))
      expect(alice.decrypt(r1.wire)).toEqual(utf8ToBytes('hi alice'))
      const m2 = alice.encrypt(utf8ToBytes('again'))
      expect(bob.decrypt(m2.wire)).toEqual(utf8ToBytes('again'))
    })

    it('handles out of order messages via skipped keys', () => {
      const { alice, bob } = buildPair(namespace)
      const m1 = alice.encrypt(utf8ToBytes('first'))
      const m2 = alice.encrypt(utf8ToBytes('second'))
      const m3 = alice.encrypt(utf8ToBytes('third'))
      expect(bob.decrypt(m3.wire)).toEqual(utf8ToBytes('third'))
      expect(bob.decrypt(m1.wire)).toEqual(utf8ToBytes('first'))
      expect(bob.decrypt(m2.wire)).toEqual(utf8ToBytes('second'))
    })

    it('rejects duplicates', () => {
      const { alice, bob } = buildPair(namespace)
      const m1 = alice.encrypt(utf8ToBytes('once'))
      bob.decrypt(m1.wire)
      expect(() => bob.decrypt(m1.wire)).toThrow()
    })

    it('rejects tampered ciphertext', () => {
      const { alice, bob } = buildPair(namespace)
      const m = alice.encrypt(utf8ToBytes('integrity'))
      m.wire[m.wire.length - 20] = (m.wire[m.wire.length - 20] ?? 0) ^ 1
      expect(() => bob.decrypt(m.wire)).toThrow()
    })

    it('survives serialization round trip', () => {
      const { alice, bob } = buildPair(namespace)
      const restored = deserializeSession(serializeSession(bob))
      const m = alice.encrypt(utf8ToBytes('persisted'))
      expect(restored.decrypt(m.wire)).toEqual(utf8ToBytes('persisted'))
    })

    it('keeps sending key exchange until confirmed', () => {
      const { alice, bob } = buildPair(namespace)
      const m1 = alice.encrypt(utf8ToBytes('one'))
      expect(m1.keyExchange).not.toBeNull()
      bob.decrypt(m1.wire)
      const r = bob.encrypt(utf8ToBytes('confirm'))
      alice.decrypt(r.wire)
      const m2 = alice.encrypt(utf8ToBytes('two'))
      expect(m2.keyExchange).toBeNull()
    })
  })
}

describe('x3dh without prekey', () => {
  it('still agrees on a secret', () => {
    const profile = PROFILES.omemo2
    const alice = makePeer('omemo2')
    const bob = makePeer('omemo2')
    const bundle = peerBundle('omemo2', bob)
    bundle.preKeys = []
    const active = x3dhInitiate(profile, alice.identity, bundle)
    expect(active.preKeyId).toBe(-1)
    const passive = x3dhRespond(profile, bob.identity, {
      ik: alice.identity.wirePublicKey,
      ek: active.ephemeral.publicKey,
      spkId: active.signedPreKeyId,
      pkId: -1,
      signedPreKey: bob.signedPreKey,
      preKey: undefined
    })
    expect(bytesEqual(active.sharedSecret, passive.sharedSecret)).toBe(true)
  })
})

// Ratchet header check: the dh_pub field of the first initiator message is
// the fresh ratchet key, not the ephemeral X3DH key.
describe('header encoding', () => {
  it('omemo2 header key is 32 bytes, legacy 33', () => {
    const a = hexToBytes('00'.repeat(32))
    expect(PROFILES.omemo2.encodeHeaderKey(a).length).toBe(32)
    expect(PROFILES.legacy.encodeHeaderKey(a).length).toBe(33)
    expect(PROFILES.legacy.decodeHeaderKey(PROFILES.legacy.encodeHeaderKey(a))).toEqual(a)
  })
})
