// Key exchange element handling. The initiator wraps the authenticated
// message in an OMEMOKeyExchange so the responder can run the passive X3DH
// side. The wire marker differs per profile: omemo:2 uses the raw proto with
// a kex attribute on the key element, legacy prepends the 0x33 version byte
// and uses a prekey attribute.

import { LEGACY_VERSION_BYTE } from '../../constants'
import type { Namespace } from '../../constants'
import { ParseError } from '../../errors'
import { concatBytes } from '../../internal/bytes'
import { getVarint, readFields, requireBytes, requireVarint } from '../../internal/protobuf'
import { KEY_EXCHANGE_LAYOUT, fieldMap } from './layout'
import { encodeKeyExchange } from './messages'
import { decodeCurveKeyWire } from '../../crypto/keys'
import type { PendingKeyExchange } from '../session/session'

export interface ParsedKeyExchange {
  pkId: number
  spkId: number
  // Identity key in wire encoding (32 bytes for omemo:2, 33 bytes for legacy).
  ik: Uint8Array
  // Ephemeral public key, raw 32 byte Montgomery.
  ek: Uint8Array
  // The wrapped authenticated message bytes.
  message: Uint8Array
}

// The pending kex stored in the session holds keys already in wire encoding:
// 32 bytes for omemo:2, 33 bytes serialized Curve25519 keys for legacy.
export function encodeKeyExchangeWire(
  namespace: Namespace,
  kex: PendingKeyExchange,
  authenticatedMessage: Uint8Array
): Uint8Array {
  const proto = encodeKeyExchange(
    {
      pkId: kex.pkId,
      spkId: kex.spkId,
      ik: kex.ik,
      ek: kex.ek,
      message: authenticatedMessage
    },
    namespace
  )
  return namespace === 'legacy' ? concatBytes(Uint8Array.of(LEGACY_VERSION_BYTE), proto) : proto
}

export function decodeKeyExchangeWire(namespace: Namespace, data: Uint8Array): ParsedKeyExchange {
  let proto = data
  if (namespace === 'legacy') {
    if (data[0] !== LEGACY_VERSION_BYTE) throw new ParseError('missing legacy version byte')
    proto = data.slice(1)
  }
  const fields = readFields(proto)
  // Field numbering per profile lives in KEY_EXCHANGE_LAYOUT. The legacy
  // layout additionally wire-encodes ek as a 33 byte Curve25519 key.
  const f = fieldMap(KEY_EXCHANGE_LAYOUT, namespace)
  const pkIdRaw = getVarint(fields, f.pkId)
  if (pkIdRaw !== undefined && (pkIdRaw < 0n || pkIdRaw > 0xffffffffn)) {
    throw new ParseError('OMEMOKeyExchange: missing or invalid field 1')
  }
  const pkId = pkIdRaw === undefined ? -1 : Number(pkIdRaw)
  const spkId = requireVarint(fields, f.spkId, 'OMEMOKeyExchange')
  const ik = requireBytes(fields, f.ik, 'OMEMOKeyExchange')
  const ekRaw = requireBytes(fields, f.ek, 'OMEMOKeyExchange')
  const message = requireBytes(fields, f.message, 'OMEMOKeyExchange')
  const ek = namespace === 'legacy' ? decodeCurveKeyWire(ekRaw) : ekRaw
  return { pkId, spkId, ik, ek, message }
}

// Heuristic detection used when the wire attribute is missing. For omemo:2
// the first tag byte unambiguously separates the OMEMOKeyExchange (field 1 is
// a varint, tag 0x08) from an OMEMOAuthenticatedMessage (field 1 is length
// delimited, tag 0x0A). For legacy both start with the version byte and only
// the prekey attribute separates them reliably, so callers should prefer the
// attribute and use this only as a fallback.
export function looksLikeKeyExchange(namespace: Namespace, data: Uint8Array): boolean {
  if (namespace === 'legacy') return false
  return (data[0] ?? 0) === 0x08
}
