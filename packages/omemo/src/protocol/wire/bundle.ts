// OMEMO bundle build and parse for both profiles. A bundle is the set of
// public key material published via PEP: identity key, signed pre key with
// signature, and one-time pre keys.

import { ed25519 } from '@noble/curves/ed25519.js'

import { CURVE_KEY_SIZE, LEGACY_KEY_WIRE_SIZE, NAMESPACES, SIGNATURE_SIZE } from '../../constants'
import type { Namespace } from '../../constants'
import { InvalidSignatureError, ParseError } from '../../errors'
import { base64Decode, base64Encode } from '../../internal/bytes'
import { childrenNamed, el, findChild, serializeXml } from '../../internal/xml'
import type { XmlElement } from '../../internal/xml'
import { decodeCurveKeyWire, edPublicToCurvePublic, encodeCurveKeyWire } from '../../crypto/keys'
import { xed25519Verify } from '../../crypto/xed25519'
import { BUNDLE_TAGS } from './layout'

// Legacy bundle keys ride on the wire as 33 byte serialized Curve25519
// keys; omemo:2 publishes the raw 32 byte key.
function encodeWireKey(namespace: Namespace, key: Uint8Array): Uint8Array {
  return namespace === 'legacy' ? encodeCurveKeyWire(key) : key
}

function decodeWireKey(namespace: Namespace, wire: Uint8Array): Uint8Array {
  return namespace === 'legacy' ? decodeCurveKeyWire(wire) : wire
}

export interface ParsedBundle {
  namespace: Namespace
  // Wire encoding of the identity key as used in associated data and key
  // exchange messages: 32 byte Ed25519 key for omemo:2, 33 byte serialized
  // Curve25519 key for legacy.
  identityKeyWire: Uint8Array
  // Montgomery u coordinate of the identity key, used for DH.
  identityKeyCurve: Uint8Array
  // The Ed25519 form of the identity key. For omemo:2 this is the same as
  // identityKeyWire; for legacy it is reconstructed from the Montgomery form
  // and the sign bit smuggled into the signature.
  identityKeyEd: Uint8Array
  signedPreKeyId: number
  signedPreKey: Uint8Array
  signedPreKeySignature: Uint8Array
  preKeys: { pkId: number; pk: Uint8Array }[]
}

export interface OwnBundle {
  namespace: Namespace
  deviceId: number
  signedPreKeyId: number
  signedPreKeyPublic: Uint8Array
  signedPreKeySignature: Uint8Array
  identityKeyWire: Uint8Array
  // Legacy only: the Montgomery u coordinate of the own identity key.
  identityKeyCurve?: Uint8Array
  // Legacy only: the Ed25519 sign bit of the own identity key, smuggled into
  // the top bit of the published signature.
  identityKeyEdSign?: 0 | 1
  preKeys: { pkId: number; pk: Uint8Array }[]
}

export function buildBundleElement(bundle: OwnBundle): XmlElement {
  const tags = BUNDLE_TAGS[bundle.namespace]
  let signature = bundle.signedPreKeySignature
  let identityKey = bundle.identityKeyWire
  if (bundle.namespace === 'legacy') {
    if (bundle.identityKeyCurve === undefined || bundle.identityKeyEdSign === undefined) {
      throw new ParseError('legacy bundle requires identityKeyCurve and identityKeyEdSign')
    }
    // The top bit of the signature smuggles the Ed25519 sign bit of the
    // identity key so receivers can reconstruct it for XEdDSA verification.
    signature = Uint8Array.from(signature)
    signature[63] = ((signature[63] ?? 0) & 0x7f) | (bundle.identityKeyEdSign << 7)
    identityKey = encodeCurveKeyWire(bundle.identityKeyCurve)
  }
  const wireKey = (key: Uint8Array): Uint8Array => encodeWireKey(bundle.namespace, key)
  return el('bundle', { xmlns: NAMESPACES[bundle.namespace].element }, [
    el(
      tags.signedPreKey,
      { [tags.signedPreKeyIdAttr]: String(bundle.signedPreKeyId) },
      [],
      base64Encode(wireKey(bundle.signedPreKeyPublic))
    ),
    el(tags.signedPreKeySignature, {}, [], base64Encode(signature)),
    el(tags.identityKey, {}, [], base64Encode(identityKey)),
    el(
      'prekeys',
      {},
      bundle.preKeys.map((pk) =>
        el(tags.preKey, { [tags.preKeyIdAttr]: String(pk.pkId) }, [], base64Encode(wireKey(pk.pk)))
      )
    )
  ])
}

export function serializeBundle(bundle: OwnBundle): string {
  return serializeXml(buildBundleElement(bundle))
}

function requireText(parent: XmlElement, name: string): Uint8Array {
  const node = findChild(parent, name)
  if (!node || !node.text.trim()) throw new ParseError(`bundle: missing <${name}>`)
  return base64Decode(node.text)
}

function requireId(node: XmlElement, attr: string): number {
  const raw = node.attrs[attr]
  if (raw === undefined) throw new ParseError(`bundle: missing attribute ${attr}`)
  const id = Number.parseInt(raw, 10)
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) {
    throw new ParseError(`bundle: invalid ${attr}`)
  }
  return id
}

export function parseBundle(element: XmlElement, namespace: Namespace): ParsedBundle {
  const tags = BUNDLE_TAGS[namespace]
  const spkElt = findChild(element, tags.signedPreKey)
  if (!spkElt) throw new ParseError(`bundle: missing <${tags.signedPreKey}>`)
  const signedPreKeyId = requireId(spkElt, tags.signedPreKeyIdAttr)
  const signedPreKey = decodeWireKey(namespace, base64Decode(spkElt.text))
  const identityKeyWire = requireText(element, tags.identityKey)
  const signature = requireText(element, tags.signedPreKeySignature)
  if (signature.length !== SIGNATURE_SIZE) {
    throw new ParseError('bundle: invalid signature length')
  }

  let identityKeyCurve: Uint8Array
  let identityKeyEd: Uint8Array
  if (namespace === 'omemo2') {
    if (signedPreKey.length !== CURVE_KEY_SIZE) {
      throw new ParseError('bundle: invalid spk length')
    }
    if (identityKeyWire.length !== CURVE_KEY_SIZE) {
      throw new ParseError('bundle: invalid ik length')
    }
    // Malformed identity keys can make noble throw instead of returning false.
    let signatureValid: boolean
    try {
      signatureValid = ed25519.verify(signature, signedPreKey, identityKeyWire)
    } catch {
      signatureValid = false
    }
    if (!signatureValid) {
      throw new InvalidSignatureError('bundle: signed pre key signature invalid')
    }
    identityKeyCurve = edPublicToCurvePublic(identityKeyWire)
    identityKeyEd = identityKeyWire
  } else {
    if (identityKeyWire.length !== LEGACY_KEY_WIRE_SIZE) {
      throw new ParseError('bundle: invalid identityKey encoding')
    }
    // Verify over the serialized 33 byte signed pre key. The smuggled top
    // bit of the signature selects the Edwards sign of the identity key.
    const spkWire = encodeCurveKeyWire(signedPreKey)
    const { valid, ed25519PublicKey } = xed25519Verify(identityKeyWire, spkWire, signature)
    if (!valid) throw new InvalidSignatureError('bundle: signed pre key signature invalid')
    identityKeyCurve = identityKeyWire.slice(1)
    identityKeyEd = ed25519PublicKey
  }

  const prekeysElt = findChild(element, 'prekeys')
  const preKeys: ParsedBundle['preKeys'] = []
  if (prekeysElt) {
    for (const pkElt of childrenNamed(prekeysElt, tags.preKey)) {
      const pk = decodeWireKey(namespace, base64Decode(pkElt.text))
      if (pk.length !== CURVE_KEY_SIZE) throw new ParseError('bundle: invalid pk length')
      preKeys.push({ pkId: requireId(pkElt, tags.preKeyIdAttr), pk })
    }
  }

  return {
    namespace,
    identityKeyWire,
    identityKeyCurve,
    identityKeyEd,
    signedPreKeyId,
    signedPreKey,
    signedPreKeySignature: signature,
    preKeys
  }
}
