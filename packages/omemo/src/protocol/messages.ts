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

import { ParseError } from '../errors'
import {
  ProtoWriter,
  getBytes,
  readFields,
  requireBytes,
  requireVarint
} from '../internal/protobuf'

export interface OmemoMessage {
  n: number
  pn: number
  dhPub: Uint8Array
  ciphertext: Uint8Array | undefined
}

// The legacy profile keeps the Signal WhisperTextProtocol field order
// (dh_pub=1, n=2, pn=3, ciphertext=4) while omemo:2 renumbers to
// n=1, pn=2, dh_pub=3, ciphertext=4.
export function encodeOmemoMessage(
  message: OmemoMessage,
  namespace: 'omemo2' | 'legacy' = 'omemo2'
): Uint8Array {
  const writer = new ProtoWriter()
  if (namespace === 'legacy') {
    writer.fieldBytes(1, message.dhPub).fieldVarint(2, message.n).fieldVarint(3, message.pn)
  } else {
    writer.fieldVarint(1, message.n).fieldVarint(2, message.pn).fieldBytes(3, message.dhPub)
  }
  if (message.ciphertext !== undefined) writer.fieldBytes(4, message.ciphertext)
  return writer.finish()
}

export function decodeOmemoMessage(
  data: Uint8Array,
  namespace: 'omemo2' | 'legacy' = 'omemo2'
): OmemoMessage {
  const fields = readFields(data)
  if (namespace === 'legacy') {
    return {
      dhPub: requireBytes(fields, 1, 'OMEMOMessage'),
      n: requireVarint(fields, 2, 'OMEMOMessage'),
      pn: requireVarint(fields, 3, 'OMEMOMessage'),
      ciphertext: getBytes(fields, 4)
    }
  }
  return {
    n: requireVarint(fields, 1, 'OMEMOMessage'),
    pn: requireVarint(fields, 2, 'OMEMOMessage'),
    dhPub: requireBytes(fields, 3, 'OMEMOMessage'),
    ciphertext: getBytes(fields, 4)
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
// to pk_id=1, spk_id=2, ik=3, ek=4, message=5.
export function encodeKeyExchange(
  kex: OmemoKeyExchange,
  namespace: 'omemo2' | 'legacy' = 'omemo2'
): Uint8Array {
  const writer = new ProtoWriter().fieldVarint(1, kex.pkId)
  if (namespace === 'legacy') {
    return writer
      .fieldBytes(2, kex.ek)
      .fieldBytes(3, kex.ik)
      .fieldBytes(4, kex.message)
      .fieldVarint(6, kex.spkId)
      .finish()
  }
  return writer
    .fieldVarint(2, kex.spkId)
    .fieldBytes(3, kex.ik)
    .fieldBytes(4, kex.ek)
    .fieldBytes(5, kex.message)
    .finish()
}

export function decodeKeyExchange(
  data: Uint8Array,
  namespace: 'omemo2' | 'legacy' = 'omemo2'
): OmemoKeyExchange {
  const fields = readFields(data)
  if (namespace === 'legacy') {
    return {
      pkId: requireVarint(fields, 1, 'OMEMOKeyExchange'),
      ek: requireBytes(fields, 2, 'OMEMOKeyExchange'),
      ik: requireBytes(fields, 3, 'OMEMOKeyExchange'),
      message: requireBytes(fields, 4, 'OMEMOKeyExchange'),
      spkId: requireVarint(fields, 6, 'OMEMOKeyExchange')
    }
  }
  return {
    pkId: requireVarint(fields, 1, 'OMEMOKeyExchange'),
    spkId: requireVarint(fields, 2, 'OMEMOKeyExchange'),
    ik: requireBytes(fields, 3, 'OMEMOKeyExchange'),
    ek: requireBytes(fields, 4, 'OMEMOKeyExchange'),
    message: requireBytes(fields, 5, 'OMEMOKeyExchange')
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
