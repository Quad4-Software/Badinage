// Namespace-parameterized wire layouts. The legacy profile keeps the Signal
// WhisperTextProtocol and PreKeyWhisperMessage protobuf field numbering and
// the Conversations-era XML element names while omemo:2 renumbered the
// proto fields and shortened the element names. Every per-namespace field
// and tag choice lives in this one module so codecs never branch on the
// namespace themselves.

import type { Namespace } from '../../constants'
import { ProtoWriter } from '../../internal/protobuf'

// One logical protobuf field: its wire kind plus the field number in each
// profile.
export interface FieldSpec {
  kind: 'varint' | 'bytes'
  omemo2: number
  legacy: number
}

function fieldNumber(spec: FieldSpec, namespace: Namespace): number {
  return namespace === 'legacy' ? spec.legacy : spec.omemo2
}

// Resolve a layout table to plain field numbers for one profile. Decoders
// use the result with getVarint, getBytes, requireVarint and requireBytes.
export function fieldMap<S extends string>(
  layout: Record<S, FieldSpec>,
  namespace: Namespace
): Record<S, number> {
  const out = {} as Record<S, number>
  for (const name of Object.keys(layout) as S[]) {
    out[name] = fieldNumber(layout[name], namespace)
  }
  return out
}

// Encode values, emitting fields in ascending field-number order and
// skipping undefined values (optional proto fields). Ascending order is
// exactly what the hand-rolled encoders produced for both profiles, so the
// emitted bytes are unchanged.
export function writeLayout<S extends string>(
  layout: Record<S, FieldSpec>,
  namespace: Namespace,
  values: Partial<Record<S, number | Uint8Array | undefined>>
): Uint8Array {
  const ordered = (Object.keys(layout) as S[]).sort(
    (a, b) => fieldNumber(layout[a], namespace) - fieldNumber(layout[b], namespace)
  )
  const writer = new ProtoWriter()
  for (const name of ordered) {
    const value = values[name]
    if (value === undefined) continue
    const number = fieldNumber(layout[name], namespace)
    if (layout[name].kind === 'varint') writer.fieldVarint(number, value as number)
    else writer.fieldBytes(number, value as Uint8Array)
  }
  return writer.finish()
}

// OMEMOMessage: the ratchet header plus ciphertext. The legacy profile
// keeps the WhisperTextProtocol order dh_pub=1, n=2, pn=3 while omemo:2
// renumbers to n=1, pn=2, dh_pub=3. ciphertext=4 in both.
export const OMEMO_MESSAGE_LAYOUT: Record<'n' | 'pn' | 'dhPub' | 'ciphertext', FieldSpec> = {
  n: { kind: 'varint', omemo2: 1, legacy: 2 },
  pn: { kind: 'varint', omemo2: 2, legacy: 3 },
  dhPub: { kind: 'bytes', omemo2: 3, legacy: 1 },
  ciphertext: { kind: 'bytes', omemo2: 4, legacy: 4 }
}

// OMEMOKeyExchange. The legacy profile keeps the PreKeyWhisperMessage
// layout ek=2, ik=3, message=4, spk_id=6 (field 5 stays unused there).
// omemo:2 renumbers to spk_id=2, ik=3, ek=4, message=5. pk_id=1 in both.
export const KEY_EXCHANGE_LAYOUT: Record<'pkId' | 'spkId' | 'ik' | 'ek' | 'message', FieldSpec> = {
  pkId: { kind: 'varint', omemo2: 1, legacy: 1 },
  spkId: { kind: 'varint', omemo2: 2, legacy: 6 },
  ik: { kind: 'bytes', omemo2: 3, legacy: 3 },
  ek: { kind: 'bytes', omemo2: 4, legacy: 2 },
  message: { kind: 'bytes', omemo2: 5, legacy: 4 }
}

// The boolean attribute that marks a <key> element as carrying a key
// exchange: kex for omemo:2, prekey for legacy.
export function kexAttribute(namespace: Namespace): string {
  return namespace === 'legacy' ? 'prekey' : 'kex'
}

// Element and attribute names of the published bundle per profile.
export interface BundleTags {
  signedPreKey: string
  signedPreKeyIdAttr: string
  signedPreKeySignature: string
  identityKey: string
  preKey: string
  preKeyIdAttr: string
}

export const BUNDLE_TAGS: Record<Namespace, BundleTags> = {
  omemo2: {
    signedPreKey: 'spk',
    signedPreKeyIdAttr: 'id',
    signedPreKeySignature: 'spks',
    identityKey: 'ik',
    preKey: 'pk',
    preKeyIdAttr: 'id'
  },
  legacy: {
    signedPreKey: 'signedPreKeyPublic',
    signedPreKeyIdAttr: 'signedPreKeyId',
    signedPreKeySignature: 'signedPreKeySignature',
    identityKey: 'identityKey',
    preKey: 'preKeyPublic',
    preKeyIdAttr: 'preKeyId'
  }
}
