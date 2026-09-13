// Profile objects capturing the differences between the two OMEMO namespace
// variants. omemo:2 (XEP-0384 >= 0.8) uses Ed25519 identities, 32 byte header
// keys and a 16 byte HMAC over an OMEMOAuthenticatedMessage wrapper. The
// legacy profile (XEP-0384 0.3, eu.siacs.conversations.axolotl) uses
// Curve25519 identities, 33 byte wire keys, an 8 byte MAC and a version byte
// prepended to the serialized OMEMOMessage.

import {
  INFO_MK_LEGACY,
  INFO_MK_OMEMO2,
  INFO_PAYLOAD_OMEMO2,
  INFO_ROOT_LEGACY,
  INFO_ROOT_OMEMO2,
  INFO_X3DH_LEGACY,
  INFO_X3DH_OMEMO2,
  LEGACY_MAC_SIZE,
  LEGACY_VERSION_BYTE,
  OMEMO2_MAC_SIZE
} from '../../constants'
import type { Namespace } from '../../constants'
import { ParseError } from '../../errors'
import { concatBytes, utf8ToBytes } from '../../internal/bytes'
import { decodeAuthenticatedMessage, encodeAuthenticatedMessage } from './messages'
import { decodeCurveKeyWire, encodeCurveKeyWire } from '../../crypto/keys'

export interface WireProfile {
  namespace: Namespace
  infoX3dh: Uint8Array
  infoRoot: Uint8Array
  infoMk: Uint8Array
  infoPayload: Uint8Array
  macSize: number
  // Encode a raw Montgomery public key for the message header dh_pub field.
  encodeHeaderKey: (publicKey: Uint8Array) => Uint8Array
  // Decode the dh_pub field back to the raw 32 byte Montgomery key.
  decodeHeaderKey: (wire: Uint8Array) => Uint8Array
  // Associated data order for the sender and the recipient. omemo:2 always
  // uses the initiator then responder order stored in the session. The legacy
  // profile flips it so the sender identity always comes first.
  adForSender: (initiation: 'active' | 'passive', ad: Uint8Array) => Uint8Array
  adForRecipient: (initiation: 'active' | 'passive', ad: Uint8Array) => Uint8Array
  // Serialize the ratchet ciphertext plus MAC into the wire representation.
  seal: (mac: Uint8Array, messageBytes: Uint8Array) => Uint8Array
  // Split the wire representation into MAC and serialized OMEMOMessage bytes.
  open: (wire: Uint8Array) => { mac: Uint8Array; messageBytes: Uint8Array }
}

function swapAdHalves(ad: Uint8Array): Uint8Array {
  if (ad.length % 2 !== 0) throw new ParseError('associated data has odd length')
  const half = ad.length / 2
  return concatBytes(ad.slice(half), ad.slice(0, half))
}

const omemo2: WireProfile = {
  namespace: 'omemo2',
  infoX3dh: utf8ToBytes(INFO_X3DH_OMEMO2),
  infoRoot: utf8ToBytes(INFO_ROOT_OMEMO2),
  infoMk: utf8ToBytes(INFO_MK_OMEMO2),
  infoPayload: utf8ToBytes(INFO_PAYLOAD_OMEMO2),
  macSize: OMEMO2_MAC_SIZE,
  encodeHeaderKey: (key) => key,
  decodeHeaderKey: (wire) => {
    if (wire.length !== 32) throw new ParseError('OMEMOMessage dh_pub must be 32 bytes')
    return wire
  },
  adForSender: (_initiation, ad) => ad,
  adForRecipient: (_initiation, ad) => ad,
  seal: (mac, messageBytes) => encodeAuthenticatedMessage({ mac, message: messageBytes }),
  open: (wire) => {
    const parsed = decodeAuthenticatedMessage(wire)
    return { mac: parsed.mac, messageBytes: parsed.message }
  }
}

const legacy: WireProfile = {
  namespace: 'legacy',
  infoX3dh: utf8ToBytes(INFO_X3DH_LEGACY),
  infoRoot: utf8ToBytes(INFO_ROOT_LEGACY),
  infoMk: utf8ToBytes(INFO_MK_LEGACY),
  // The legacy profile has no distinct payload info. AES-128-GCM keys are raw.
  infoPayload: utf8ToBytes(INFO_MK_LEGACY),
  macSize: LEGACY_MAC_SIZE,
  encodeHeaderKey: (key) => encodeCurveKeyWire(key),
  decodeHeaderKey: (wire) => decodeCurveKeyWire(wire),
  adForSender: (initiation, ad) => (initiation === 'passive' ? swapAdHalves(ad) : ad),
  adForRecipient: (initiation, ad) => (initiation === 'active' ? swapAdHalves(ad) : ad),
  seal: (mac, messageBytes) => concatBytes(messageBytes, mac),
  open: (wire) => {
    if (wire.length < LEGACY_MAC_SIZE + 2) throw new ParseError('legacy message too short')
    const body = wire.slice(0, wire.length - LEGACY_MAC_SIZE)
    if (body[0] !== LEGACY_VERSION_BYTE) throw new ParseError('unsupported legacy message version')
    return { mac: wire.slice(wire.length - LEGACY_MAC_SIZE), messageBytes: body }
  }
}

export const PROFILES: Record<Namespace, WireProfile> = { omemo2, legacy }

// Marshal an OMEMOMessage serialization for transport inside the
// authenticated container. The legacy profile prepends the protocol version
// byte which is covered by the MAC.
export function marshalMessage(profile: WireProfile, messageBytes: Uint8Array): Uint8Array {
  return profile.namespace === 'legacy'
    ? concatBytes(Uint8Array.of(LEGACY_VERSION_BYTE), messageBytes)
    : messageBytes
}

export function unmarshalMessage(profile: WireProfile, messageBytes: Uint8Array): Uint8Array {
  if (profile.namespace !== 'legacy') return messageBytes
  if (messageBytes[0] !== LEGACY_VERSION_BYTE) {
    throw new ParseError('unsupported legacy message version')
  }
  return messageBytes.slice(1)
}
