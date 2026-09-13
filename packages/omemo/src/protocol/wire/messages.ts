// Protobuf wire structures from XEP-0384. Schemas, matching libomemo-c:
//
// message OMEMOMessage { required uint32 n = 1; required uint32 pn = 2;
//   required bytes dh_pub = 3; optional bytes ciphertext = 4; }
// message OMEMOAuthenticatedMessage { required bytes mac = 1;
//   required bytes message = 2; }
// message OMEMOKeyExchange { required uint32 pk_id = 1;
//   required uint32 spk_id = 2; required bytes ik = 3; required bytes ek = 4;
//   required bytes message = 5; }
// message OMEMOBundle { required uint32 spk_id = 1; required bytes spk = 2;
//   required bytes spk_signature = 3; required bytes ik = 4;
//   repeated OMEMOPreKey prekeys = 5; }
// message OMEMOPreKey { required uint32 pk_id = 1; required bytes pk = 2; }

import { ParseError } from '../../errors'
import {
  ProtoWriter,
  getBytes,
  getVarint,
  readFields,
  requireBytes,
  requireVarint
} from '../../internal/protobuf'
import type { ProtoField } from '../../internal/protobuf'
import { KEY_EXCHANGE_LAYOUT, OMEMO_MESSAGE_LAYOUT, fieldMap, writeLayout } from './layout'

export interface OmemoMessage {
  n: number
  pn: number
  dhPub: Uint8Array
  ciphertext: Uint8Array | undefined
}

// The legacy profile keeps the Signal WhisperTextProtocol field order
// (dh_pub=1, n=2, pn=3, ciphertext=4) while omemo:2 renumbers to
// n=1, pn=2, dh_pub=3, ciphertext=4. The numbering lives in
// OMEMO_MESSAGE_LAYOUT.
export function encodeOmemoMessage(
  message: OmemoMessage,
  namespace: 'omemo2' | 'legacy' = 'omemo2'
): Uint8Array {
  return writeLayout(OMEMO_MESSAGE_LAYOUT, namespace, {
    n: message.n,
    pn: message.pn,
    dhPub: message.dhPub,
    ciphertext: message.ciphertext
  })
}

export function decodeOmemoMessage(
  data: Uint8Array,
  namespace: 'omemo2' | 'legacy' = 'omemo2'
): OmemoMessage {
  const fields = readFields(data)
  const f = fieldMap(OMEMO_MESSAGE_LAYOUT, namespace)
  return {
    n: requireVarint(fields, f.n, 'OMEMOMessage'),
    pn: requireVarint(fields, f.pn, 'OMEMOMessage'),
    dhPub: requireBytes(fields, f.dhPub, 'OMEMOMessage'),
    ciphertext: getBytes(fields, f.ciphertext)
  }
}

export interface OmemoAuthenticatedMessage {
  mac: Uint8Array
  message: Uint8Array
}

export function encodeAuthenticatedMessage(message: OmemoAuthenticatedMessage): Uint8Array {
  return new ProtoWriter().fieldBytes(1, message.mac).fieldBytes(2, message.message).finish()
}

export function decodeAuthenticatedMessage(data: Uint8Array): OmemoAuthenticatedMessage {
  const fields = readFields(data)
  return {
    mac: requireBytes(fields, 1, 'OMEMOAuthenticatedMessage'),
    message: requireBytes(fields, 2, 'OMEMOAuthenticatedMessage')
  }
}

export interface OmemoKeyExchange {
  pkId: number
  spkId: number
  ik: Uint8Array
  ek: Uint8Array
  message: Uint8Array
}

// The legacy profile keeps the Signal PreKeyWhisperMessage layout:
// pk_id=1, ek=2, ik=3, message=4, unused=5, spk_id=6. omemo:2 renumbers
// to pk_id=1, spk_id=2, ik=3, ek=4, message=5. The numbering lives in
// KEY_EXCHANGE_LAYOUT. A negative pkId means the key exchange did not use
// a one-time pre key. The field is omitted then.
export function encodeKeyExchange(
  kex: OmemoKeyExchange,
  namespace: 'omemo2' | 'legacy' = 'omemo2'
): Uint8Array {
  return writeLayout(KEY_EXCHANGE_LAYOUT, namespace, {
    pkId: kex.pkId >= 0 ? kex.pkId : undefined,
    spkId: kex.spkId,
    ik: kex.ik,
    ek: kex.ek,
    message: kex.message
  })
}

// pk_id is -1 when the field is absent (no one-time pre key was used).
function decodePkId(fields: ProtoField[]): number {
  const raw = getVarint(fields, 1)
  if (raw === undefined) return -1
  if (raw < 0n || raw > 0xffffffffn) {
    throw new ParseError('OMEMOKeyExchange: missing or invalid field 1')
  }
  return Number(raw)
}

export function decodeKeyExchange(
  data: Uint8Array,
  namespace: 'omemo2' | 'legacy' = 'omemo2'
): OmemoKeyExchange {
  const fields = readFields(data)
  const f = fieldMap(KEY_EXCHANGE_LAYOUT, namespace)
  return {
    pkId: decodePkId(fields),
    spkId: requireVarint(fields, f.spkId, 'OMEMOKeyExchange'),
    ik: requireBytes(fields, f.ik, 'OMEMOKeyExchange'),
    ek: requireBytes(fields, f.ek, 'OMEMOKeyExchange'),
    message: requireBytes(fields, f.message, 'OMEMOKeyExchange')
  }
}

export interface BundlePreKey {
  pkId: number
  pk: Uint8Array
}

export interface OmemoBundle {
  spkId: number
  spk: Uint8Array
  spkSignature: Uint8Array
  ik: Uint8Array
  preKeys: BundlePreKey[]
}

export function encodeBundle(bundle: OmemoBundle): Uint8Array {
  const writer = new ProtoWriter()
    .fieldVarint(1, bundle.spkId)
    .fieldBytes(2, bundle.spk)
    .fieldBytes(3, bundle.spkSignature)
    .fieldBytes(4, bundle.ik)
  for (const preKey of bundle.preKeys) {
    const inner = new ProtoWriter().fieldVarint(1, preKey.pkId).fieldBytes(2, preKey.pk).finish()
    writer.fieldBytes(5, inner)
  }
  return writer.finish()
}

export function decodeBundle(data: Uint8Array): OmemoBundle {
  const fields = readFields(data)
  const preKeys: BundlePreKey[] = []
  for (const field of fields) {
    if (field.number !== 5 || field.bytes === undefined) continue
    const inner = readFields(field.bytes)
    preKeys.push({
      pkId: requireVarint(inner, 1, 'OMEMOPreKey'),
      pk: requireBytes(inner, 2, 'OMEMOPreKey')
    })
  }
  if (preKeys.length === 0) throw new ParseError('OMEMOBundle: no prekeys')
  return {
    spkId: requireVarint(fields, 1, 'OMEMOBundle'),
    spk: requireBytes(fields, 2, 'OMEMOBundle'),
    spkSignature: requireBytes(fields, 3, 'OMEMOBundle'),
    ik: requireBytes(fields, 4, 'OMEMOBundle'),
    preKeys
  }
}
