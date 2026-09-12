// Device key material helpers shared by the manager: identity generation,
// signed pre key generation, own bundle assembly, and responder-side session
// creation from an incoming key exchange.

import { ed25519 } from '@noble/curves/ed25519.js'

import type { Namespace } from '../constants'
import { MissingPreKeyError, ProtocolError } from '../errors'
import {
  curveSecretSignBit,
  encodeCurveKeyWire,
  generateCurve25519Identity,
  generateEd25519KeyPair,
  generateX25519KeyPair
} from '../crypto/keys'
import { xed25519Sign } from '../crypto/xed25519'
import type { XmlElement } from '../internal/xml'
import type { OmemoStore } from '../store/interface'
import { buildBundleElement } from './bundle'
import type { OwnBundle } from './bundle'
import type { ParsedKeyExchange } from './keyExchange'
import type { WireProfile } from './profiles'
import { Session } from './session'
import { sessionResponder } from './sessionInit'
import type { RatchetLimits } from './session'
import { x3dhRespond } from './x3dh'
import type { IdentityMaterial } from './x3dh'

export async function ensureIdentity(store: OmemoStore, namespace: Namespace): Promise<void> {
  if (await store.getIdentity()) return
  if (namespace === 'omemo2') {
    const pair = generateEd25519KeyPair()
    await store.putIdentity({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      wirePublicKey: pair.publicKey
    })
  } else {
    const pair = generateCurve25519Identity()
    await store.putIdentity({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      wirePublicKey: encodeCurveKeyWire(pair.publicKey)
    })
  }
}

export async function requireIdentity(store: OmemoStore): Promise<IdentityMaterial> {
  const record = await store.getIdentity()
  if (!record) throw new ProtocolError('identity not initialized')
  return {
    privateKey: record.privateKey,
    publicKey: record.publicKey,
    wirePublicKey: record.wirePublicKey
  }
}

export async function generateSignedPreKey(
  store: OmemoStore,
  namespace: Namespace,
  id: number
): Promise<void> {
  const identity = await requireIdentity(store)
  const pair = generateX25519KeyPair()
  const signature =
    namespace === 'omemo2'
      ? ed25519.sign(pair.publicKey, identity.privateKey)
      : xed25519Sign(identity.privateKey, encodeCurveKeyWire(pair.publicKey))
  await store.putSignedPreKey({ id, pair, signature, createdAt: Date.now() })
}

// Assemble the own bundle element from stored key material. The most recently
// stored signed pre key is used.
export async function buildOwnBundle(
  store: OmemoStore,
  namespace: Namespace,
  deviceId: number
): Promise<XmlElement> {
  const identity = await requireIdentity(store)
  const spkIds = await store.listSignedPreKeyIds()
  const spkId = spkIds[spkIds.length - 1]
  if (spkId === undefined) throw new ProtocolError('no signed pre key')
  const spk = await store.getSignedPreKey(spkId)
  if (!spk) throw new ProtocolError('signed pre key missing')

  const preKeys: { pkId: number; pk: Uint8Array }[] = []
  for (const id of await store.listPreKeyIds()) {
    const pair = await store.getPreKey(id)
    if (pair) preKeys.push({ pkId: id, pk: pair.publicKey })
  }

  const bundle: OwnBundle = {
    namespace,
    deviceId,
    signedPreKeyId: spkId,
    signedPreKeyPublic: spk.pair.publicKey,
    signedPreKeySignature: spk.signature,
    identityKeyWire: identity.wirePublicKey,
    preKeys
  }
  if (namespace === 'legacy') {
    bundle.identityKeyCurve = identity.publicKey
    bundle.identityKeyEdSign = curveSecretSignBit(identity.privateKey)
  }
  return buildBundleElement(bundle)
}

// Responder side of an incoming key exchange: look up the referenced signed
// pre key and one-time pre key, run passive X3DH and create the session.
export async function respondToKeyExchange(
  store: OmemoStore,
  profile: WireProfile,
  kex: ParsedKeyExchange,
  limits: RatchetLimits
): Promise<Session> {
  const identity = await requireIdentity(store)
  const spk = await store.getSignedPreKey(kex.spkId)
  if (!spk) throw new MissingPreKeyError(`unknown signed pre key ${kex.spkId}`)
  let preKey
  if (kex.pkId >= 0) {
    preKey = await store.getPreKey(kex.pkId)
    if (!preKey) throw new MissingPreKeyError(`unknown pre key ${kex.pkId}`)
  }
  const result = x3dhRespond(profile, identity, {
    ik: kex.ik,
    ek: kex.ek,
    spkId: kex.spkId,
    pkId: kex.pkId,
    signedPreKey: spk.pair,
    preKey
  })
  return sessionResponder(
    profile,
    {
      sharedSecret: result.sharedSecret,
      associatedData: result.associatedData,
      ownRatchet: result.signedPreKey,
      localIdentity: identity.wirePublicKey,
      remoteIdentity: result.remoteIdentityWire
    },
    limits
  )
}
