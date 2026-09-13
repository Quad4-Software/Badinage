import { test } from 'vitest'

import type { Namespace } from '../src/constants'
import { utf8ToBytes } from '../src/internal/bytes'
import {
  encodeCurveKeyWire,
  generateCurve25519Identity,
  generateEd25519KeyPair,
  generateX25519KeyPair,
  edPublicToCurvePublic
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

interface TestPeer {
  identity: IdentityMaterial
  signedPreKey: KeyPair
  preKey: KeyPair
  spkSignature: Uint8Array
  signedPreKeyId: number
  preKeyId: number
}

function makePeer(namespace: Namespace): TestPeer {
  if (namespace === 'omemo2') {
    const ik = generateEd25519KeyPair()
    return {
      identity: {
        privateKey: ik.privateKey,
        publicKey: ik.publicKey,
        wirePublicKey: ik.publicKey
      },
      signedPreKey: generateX25519KeyPair(),
      spkSignature: new Uint8Array(64),
      signedPreKeyId: 0,
      preKey: generateX25519KeyPair(),
      preKeyId: 3
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
    signedPreKey: spk,
    spkSignature: xed25519Sign(ik.privateKey, encodeCurveKeyWire(spk.publicKey)),
    signedPreKeyId: 0,
    preKey: generateX25519KeyPair(),
    preKeyId: 3
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

function buildPair(namespace: Namespace): { alice: Session; bob: Session } {
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

  const bobSession = sessionResponder(profile, {
    sharedSecret: respond.sharedSecret,
    associatedData: respond.associatedData,
    ownRatchet: respond.signedPreKey,
    localIdentity: bob.identity.wirePublicKey,
    remoteIdentity: respond.remoteIdentityWire
  })

  return { alice: aliceSession, bob: bobSession }
}

const plaintext = utf8ToBytes('a typical omemo payload, key wrapped inside sce')

for (const namespace of ['omemo2', 'legacy'] as const) {
  test(`ratchet encrypt (${namespace})`, async ({ bench }) => {
    const { alice } = buildPair(namespace)
    await bench('ratchet encrypt', () => {
      alice.encrypt(plaintext)
    }).run()
  })

  test(`ratchet decrypt (${namespace})`, async ({ bench }) => {
    const { alice, bob } = buildPair(namespace)
    let wire = alice.encrypt(plaintext).wire
    await bench(
      'ratchet decrypt',
      {
        beforeEach() {
          wire = alice.encrypt(plaintext).wire
        }
      },
      () => {
        bob.decrypt(wire)
      }
    ).run()
  })

  test(`x3dh initiate (${namespace})`, async ({ bench }) => {
    const bundle = peerBundle(namespace, makePeer(namespace))
    const initiator = makePeer(namespace)
    await bench('x3dh initiate', () => {
      x3dhInitiate(PROFILES[namespace], initiator.identity, bundle)
    }).run()
  })
}
