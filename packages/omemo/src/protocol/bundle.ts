// OMEMO bundle build and parse for both profiles. A bundle is the set of
// public key material published via PEP: identity key, signed pre key with
// signature, and one-time pre keys.

import { ed25519 } from '@noble/curves/ed25519.js'

import { CURVE_KEY_SIZE, LEGACY_KEY_WIRE_SIZE, NAMESPACES, SIGNATURE_SIZE } from '../constants'
import type { Namespace } from '../constants'
import { InvalidSignatureError, ParseError } from '../errors'
import { base64Decode, base64Encode } from '../internal/bytes'
import { childrenNamed, el, findChild, serializeXml } from '../internal/xml'
import type { XmlElement } from '../internal/xml'
import { decodeCurveKeyWire, edPublicToCurvePublic, encodeCurveKeyWire } from '../crypto/keys'
import { xed25519Verify } from '../crypto/xed25519'

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
  if (bundle.namespace === 'omemo2') {
    return el('bundle', { xmlns: NAMESPACES.omemo2.element }, [
      el('spk', { id: String(bundle.signedPreKeyId) }, [], base64Encode(bundle.signedPreKeyPublic)),
      el('spks', {}, [], base64Encode(bundle.signedPreKeySignature)),
      el('ik', {}, [], base64Encode(bundle.identityKeyWire)),
      el(
        'prekeys',
        {},
        bundle.preKeys.map((pk) => el('pk', { id: String(pk.pkId) }, [], base64Encode(pk.pk)))
      )
    ])
  }

  if (bundle.identityKeyCurve === undefined || bundle.identityKeyEdSign === undefined) {
    throw new ParseError('legacy bundle requires identityKeyCurve and identityKeyEdSign')
  }
  // Legacy: the top bit of the signature smuggles the Ed25519 sign bit of the
  // identity key so receivers can reconstruct it for XEdDSA verification.
  const signature = Uint8Array.from(bundle.signedPreKeySignature)
  signature[63] = ((signature[63] ?? 0) & 0x7f) | (bundle.identityKeyEdSign << 7)
  return el('bundle', { xmlns: NAMESPACES.legacy.element }, [
    el(
      'signedPreKeyPublic',
      { signedPreKeyId: String(bundle.signedPreKeyId) },
      [],
      base64Encode(encodeCurveKeyWire(bundle.signedPreKeyPublic))
    ),
    el('signedPreKeySignature', {}, [], base64Encode(signature)),
    el('identityKey', {}, [], base64Encode(encodeCurveKeyWire(bundle.identityKeyCurve))),
    el(
      'prekeys',
      {},
      bundle.preKeys.map((pk) =>
        el(
          'preKeyPublic',
          { preKeyId: String(pk.pkId) },
          [],
          base64Encode(encodeCurveKeyWire(pk.pk))
        )
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
  if (namespace === 'omemo2') return parseBundleOmemo2(element)
  return parseBundleLegacy(element)
}

function parseBundleOmemo2(element: XmlElement): ParsedBundle {
  const spkElt = findChild(element, 'spk')
  if (!spkElt) throw new ParseError('bundle: missing <spk>')
  const signedPreKeyId = requireId(spkElt, 'id')
  const signedPreKey = base64Decode(spkElt.text)
  const signedPreKeySignature = requireText(element, 'spks')
  const identityKeyWire = requireText(element, 'ik')
  if (signedPreKey.length !== CURVE_KEY_SIZE) throw new ParseError('bundle: invalid spk length')
  if (signedPreKeySignature.length !== SIGNATURE_SIZE) {
    throw new ParseError('bundle: invalid spks length')
  }
  if (identityKeyWire.length !== CURVE_KEY_SIZE) throw new ParseError('bundle: invalid ik length')

  if (!ed25519.verify(signedPreKeySignature, signedPreKey, identityKeyWire)) {
    throw new InvalidSignatureError('bundle: signed pre key signature invalid')
  }

  const prekeysElt = findChild(element, 'prekeys')
  const preKeys: ParsedBundle['preKeys'] = []
  if (prekeysElt) {
    for (const pkElt of childrenNamed(prekeysElt, 'pk')) {
      const pk = base64Decode(pkElt.text)
      if (pk.length !== CURVE_KEY_SIZE) throw new ParseError('bundle: invalid pk length')
      preKeys.push({ pkId: requireId(pkElt, 'id'), pk })
    }
  }

  return {
    namespace: 'omemo2',
    identityKeyWire,
    identityKeyCurve: edPublicToCurvePublic(identityKeyWire),
    identityKeyEd: identityKeyWire,
    signedPreKeyId,
    signedPreKey,
    signedPreKeySignature,
    preKeys
  }
}

function parseBundleLegacy(element: XmlElement): ParsedBundle {
  const spkElt = findChild(element, 'signedPreKeyPublic')
  if (!spkElt) throw new ParseError('bundle: missing <signedPreKeyPublic>')
  const signedPreKeyId = requireId(spkElt, 'signedPreKeyId')
  const signedPreKey = decodeCurveKeyWire(base64Decode(spkElt.text))
  const identityKeyWire = requireText(element, 'identityKey')
  if (identityKeyWire.length !== LEGACY_KEY_WIRE_SIZE) {
    throw new ParseError('bundle: invalid identityKey encoding')
  }
  const signature = requireText(element, 'signedPreKeySignature')
  if (signature.length !== SIGNATURE_SIZE) throw new ParseError('bundle: invalid signature length')

  // Verify over the serialized 33 byte signed pre key. The smuggled top bit
  // of the signature selects the Edwards sign of the identity key.
  const spkWire = encodeCurveKeyWire(signedPreKey)
  const { valid, ed25519PublicKey } = xed25519Verify(identityKeyWire, spkWire, signature)
  if (!valid) throw new InvalidSignatureError('bundle: signed pre key signature invalid')

  const prekeysElt = findChild(element, 'prekeys')
  const preKeys: ParsedBundle['preKeys'] = []
  if (prekeysElt) {
    for (const pkElt of childrenNamed(prekeysElt, 'preKeyPublic')) {
      preKeys.push({
        pkId: requireId(pkElt, 'preKeyId'),
        pk: decodeCurveKeyWire(base64Decode(pkElt.text))
      })
    }
  }

  return {
    namespace: 'legacy',
    identityKeyWire,
    identityKeyCurve: identityKeyWire.slice(1),
    identityKeyEd: ed25519PublicKey,
    signedPreKeyId,
    signedPreKey,
    signedPreKeySignature: signature,
    preKeys
  }
}
