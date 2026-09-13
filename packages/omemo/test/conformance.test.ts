// Spec conformance (drift) tests. These pin the protocol surface to
// XEP-0384 values so accidental changes to namespaces, KDF info strings,
// magic bytes, sizes, or the protobuf schema fail loudly.

import { describe, expect, it } from 'vitest'

import {
  CHAIN_CONSTANT_CHAIN,
  CHAIN_CONSTANT_MESSAGE,
  CURVE_KEY_SIZE,
  DEVICE_ID_MAX,
  GCM_IV_SIZE,
  GCM_TAG_SIZE,
  HEARTBEAT_THRESHOLD,
  HKDF_SALT_SIZE,
  INFO_MK_LEGACY,
  INFO_MK_OMEMO2,
  INFO_PAYLOAD_OMEMO2,
  INFO_ROOT_LEGACY,
  INFO_ROOT_OMEMO2,
  INFO_X3DH_LEGACY,
  INFO_X3DH_OMEMO2,
  KEY_MATERIAL_SIZE,
  LEGACY_KEY_TYPE_BYTE,
  LEGACY_KEY_WIRE_SIZE,
  LEGACY_MAC_SIZE,
  LEGACY_PAYLOAD_KEY_SIZE,
  LEGACY_VERSION_BYTE,
  MAX_SKIP,
  MAX_SKIPPED_KEYS,
  MESSAGE_KEY_SIZE,
  NAMESPACES,
  NS_JABBER_CLIENT,
  NS_LEGACY,
  NS_LEGACY_BUNDLES,
  NS_LEGACY_DEVICELIST,
  NS_OMEMO2,
  NS_OMEMO2_BUNDLES,
  NS_OMEMO2_DEVICES,
  NS_SCE,
  OMEMO2_EMPTY_PLAINTEXT_SIZE,
  OMEMO2_MAC_SIZE,
  OMEMO2_PAYLOAD_KEY_SIZE,
  PREKEY_COUNT_DEFAULT,
  PREKEY_COUNT_MIN_LEGACY,
  PREKEY_COUNT_MIN_OMEMO2,
  SIGNATURE_SIZE,
  X3DH_PAD_BYTE,
  X3DH_PAD_SIZE
} from '../src/constants'
import { PROFILES } from '../src/protocol/wire/profiles'
import { ProtoWriter, readFields } from '../src/internal/protobuf'
import {
  encodeAuthenticatedMessage,
  encodeBundle,
  encodeKeyExchange,
  encodeOmemoMessage
} from '../src/protocol/wire/messages'

describe('namespaces match XEP-0384', () => {
  it('omemo:2 uris', () => {
    expect(NS_OMEMO2).toBe('urn:xmpp:omemo:2')
    expect(NS_OMEMO2_DEVICES).toBe('urn:xmpp:omemo:2:devices')
    expect(NS_OMEMO2_BUNDLES).toBe('urn:xmpp:omemo:2:bundles')
  })

  it('legacy uris', () => {
    expect(NS_LEGACY).toBe('eu.siacs.conversations.axolotl')
    expect(NS_LEGACY_DEVICELIST).toBe('eu.siacs.conversations.axolotl.devicelist')
    expect(NS_LEGACY_BUNDLES).toBe('eu.siacs.conversations.axolotl.bundles')
  })

  it('sce and client uris', () => {
    expect(NS_SCE).toBe('urn:xmpp:sce:1')
    expect(NS_JABBER_CLIENT).toBe('jabber:client')
  })

  it('NAMESPACES table is consistent', () => {
    expect(NAMESPACES.omemo2.element).toBe(NS_OMEMO2)
    expect(NAMESPACES.legacy.element).toBe(NS_LEGACY)
    expect(Object.keys(NAMESPACES).sort()).toEqual(['legacy', 'omemo2'])
  })
})

describe('kdf info strings match the specification', () => {
  it('omemo:2 info strings', () => {
    expect(INFO_X3DH_OMEMO2).toBe('OMEMO X3DH')
    expect(INFO_ROOT_OMEMO2).toBe('OMEMO Root Chain')
    expect(INFO_MK_OMEMO2).toBe('OMEMO Message Key Material')
    expect(INFO_PAYLOAD_OMEMO2).toBe('OMEMO Payload')
  })

  it('legacy info strings (Signal heritage)', () => {
    expect(INFO_X3DH_LEGACY).toBe('WhisperText')
    expect(INFO_ROOT_LEGACY).toBe('WhisperRatchet')
    expect(INFO_MK_LEGACY).toBe('WhisperMessageKeys')
  })
})

describe('protocol magic values', () => {
  it('sizes', () => {
    expect(CURVE_KEY_SIZE).toBe(32)
    expect(SIGNATURE_SIZE).toBe(64)
    expect(OMEMO2_MAC_SIZE).toBe(16)
    expect(LEGACY_MAC_SIZE).toBe(8)
    expect(LEGACY_VERSION_BYTE).toBe(0x33)
    expect(LEGACY_KEY_TYPE_BYTE).toBe(0x05)
    expect(LEGACY_KEY_WIRE_SIZE).toBe(33)
    expect(GCM_TAG_SIZE).toBe(16)
    expect(GCM_IV_SIZE).toBe(12)
    expect(LEGACY_PAYLOAD_KEY_SIZE).toBe(16)
    expect(OMEMO2_PAYLOAD_KEY_SIZE).toBe(32)
    expect(OMEMO2_EMPTY_PLAINTEXT_SIZE).toBe(32)
    expect(HKDF_SALT_SIZE).toBe(32)
    expect(X3DH_PAD_SIZE).toBe(32)
    expect(X3DH_PAD_BYTE).toBe(0xff)
    expect(KEY_MATERIAL_SIZE).toBe(80)
    expect(MESSAGE_KEY_SIZE).toBe(32)
  })

  it('ratchet constants and limits', () => {
    expect(CHAIN_CONSTANT_MESSAGE).toBe(0x01)
    expect(CHAIN_CONSTANT_CHAIN).toBe(0x02)
    expect(MAX_SKIP).toBe(1000)
    expect(MAX_SKIPPED_KEYS).toBe(1000)
    expect(HEARTBEAT_THRESHOLD).toBe(53)
    expect(PREKEY_COUNT_DEFAULT).toBe(100)
    expect(PREKEY_COUNT_MIN_OMEMO2).toBe(25)
    expect(PREKEY_COUNT_MIN_LEGACY).toBe(20)
    expect(DEVICE_ID_MAX).toBe(0x7fffffff)
  })
})

describe('wire profiles match the spec', () => {
  it('omemo:2 uses 16 byte macs inside the authenticated message wrapper', () => {
    const profile = PROFILES.omemo2
    expect(profile.macSize).toBe(16)
    const wire = profile.seal(new Uint8Array(16), Uint8Array.of(1, 2, 3))
    const fields = readFields(wire)
    // OMEMOAuthenticatedMessage: mac field 1, message field 2
    expect(fields[0]?.number).toBe(1)
    expect(fields[1]?.number).toBe(2)
  })

  it('legacy uses 8 byte macs appended after a 0x33 version byte', () => {
    const profile = PROFILES.legacy
    expect(profile.macSize).toBe(8)
    const wire = profile.seal(new Uint8Array(8), Uint8Array.of(LEGACY_VERSION_BYTE, 9, 9))
    expect(wire[0]).toBe(LEGACY_VERSION_BYTE)
    expect(wire.length).toBe(1 + 2 + 8)
  })

  it('legacy header keys are 33 bytes with the 0x05 curve25519 type prefix', () => {
    const profile = PROFILES.legacy
    const wire = profile.encodeHeaderKey(new Uint8Array(32).fill(7))
    expect(wire.length).toBe(33)
    expect(wire[0]).toBe(0x05)
    expect(profile.decodeHeaderKey(wire)).toEqual(new Uint8Array(32).fill(7))
  })

  it('omemo:2 header keys are raw 32 bytes', () => {
    const profile = PROFILES.omemo2
    const key = new Uint8Array(32).fill(9)
    expect(profile.encodeHeaderKey(key)).toEqual(key)
    expect(profile.decodeHeaderKey(key)).toEqual(key)
  })
})

describe('protobuf schema field numbers are stable', () => {
  const fieldNumbers = (data: Uint8Array) => readFields(data).map((f) => f.number)

  it('OMEMOMessage: n=1, pn=2, dh_pub=3, ciphertext=4', () => {
    const wire = encodeOmemoMessage({
      n: 1,
      pn: 0,
      dhPub: new Uint8Array(32),
      ciphertext: Uint8Array.of(1)
    })
    expect(fieldNumbers(wire)).toEqual([1, 2, 3, 4])
  })

  it('OMEMOAuthenticatedMessage: mac=1, message=2', () => {
    const wire = encodeAuthenticatedMessage({ mac: new Uint8Array(8), message: Uint8Array.of(1) })
    expect(fieldNumbers(wire)).toEqual([1, 2])
  })

  it('OMEMOKeyExchange: pk_id=1, spk_id=2, ik=3, ek=4, message=5', () => {
    const wire = encodeKeyExchange({
      pkId: 7,
      spkId: 3,
      ik: new Uint8Array(33),
      ek: new Uint8Array(32),
      message: Uint8Array.of(1)
    })
    expect(fieldNumbers(wire)).toEqual([1, 2, 3, 4, 5])
  })

  it('OMEMOBundle: spk_id=1, spk=2, spk_signature=3, ik=4, prekeys=5 repeated', () => {
    const wire = encodeBundle({
      spkId: 1,
      spk: new Uint8Array(33),
      spkSignature: new Uint8Array(64),
      ik: new Uint8Array(33),
      preKeys: [
        { pkId: 1, pk: new Uint8Array(32) },
        { pkId: 2, pk: new Uint8Array(32) }
      ]
    })
    expect(fieldNumbers(wire)).toEqual([1, 2, 3, 4, 5, 5])
  })

  it('OMEMOPreKey nested: pk_id=1, pk=2', () => {
    const inner = new ProtoWriter().fieldVarint(1, 42).fieldBytes(2, new Uint8Array(32)).finish()
    expect(fieldNumbers(inner)).toEqual([1, 2])
  })
})
