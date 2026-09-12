// Central constants for the OMEMO implementation (XEP-0384).
// All protocol magic values live here so the rest of the code is free of literals.

export const NS_OMEMO2 = 'urn:xmpp:omemo:2'
export const NS_OMEMO2_DEVICES = 'urn:xmpp:omemo:2:devices'
export const NS_OMEMO2_BUNDLES = 'urn:xmpp:omemo:2:bundles'
export const NS_LEGACY = 'eu.siacs.conversations.axolotl'
export const NS_LEGACY_DEVICELIST = 'eu.siacs.conversations.axolotl.devicelist'
export const NS_LEGACY_BUNDLES = 'eu.siacs.conversations.axolotl.bundles'
export const NS_SCE = 'urn:xmpp:sce:1'
export const NS_JABBER_CLIENT = 'jabber:client'

export type Namespace = 'omemo2' | 'legacy'

export const NAMESPACES: Record<Namespace, { element: string; devices: string; bundles: string }> =
  {
    omemo2: { element: NS_OMEMO2, devices: NS_OMEMO2_DEVICES, bundles: NS_OMEMO2_BUNDLES },
    legacy: { element: NS_LEGACY, devices: NS_LEGACY_DEVICELIST, bundles: NS_LEGACY_BUNDLES }
  }

// HKDF info strings per profile
export const INFO_X3DH_OMEMO2 = 'OMEMO X3DH'
export const INFO_ROOT_OMEMO2 = 'OMEMO Root Chain'
export const INFO_MK_OMEMO2 = 'OMEMO Message Key Material'
export const INFO_PAYLOAD_OMEMO2 = 'OMEMO Payload'
export const INFO_X3DH_LEGACY = 'WhisperText'
export const INFO_ROOT_LEGACY = 'WhisperRatchet'
export const INFO_MK_LEGACY = 'WhisperMessageKeys'

// Key and tag sizes in bytes
export const CURVE_KEY_SIZE = 32
export const SIGNATURE_SIZE = 64
export const OMEMO2_MAC_SIZE = 16
export const LEGACY_MAC_SIZE = 8
export const LEGACY_VERSION_BYTE = 0x33
export const LEGACY_KEY_TYPE_BYTE = 0x05
export const LEGACY_KEY_WIRE_SIZE = 33
export const GCM_TAG_SIZE = 16
export const GCM_IV_SIZE = 12
export const LEGACY_PAYLOAD_KEY_SIZE = 16
export const OMEMO2_PAYLOAD_KEY_SIZE = 32
export const OMEMO2_EMPTY_PLAINTEXT_SIZE = 32
export const HKDF_SALT_SIZE = 32
export const X3DH_PAD_SIZE = 32
export const KEY_MATERIAL_SIZE = 80
export const MESSAGE_KEY_SIZE = 32

// Message chain KDF constants: HMAC(chainKey, byte) produces message key / next chain key
export const CHAIN_CONSTANT_MESSAGE = 0x01
export const CHAIN_CONSTANT_CHAIN = 0x02

// Ratchet limits recommended by XEP-0384
export const MAX_SKIP = 1000
export const MAX_SKIPPED_KEYS = 1000
export const HEARTBEAT_THRESHOLD = 53

// Bundle sizing guidance from the XEP
export const PREKEY_COUNT_DEFAULT = 100
export const PREKEY_COUNT_MIN_OMEMO2 = 25
export const PREKEY_COUNT_MIN_LEGACY = 20

// Device ids and prekey ids are positive signed 32 bit integers
export const DEVICE_ID_MAX = 0x7fffffff

// X3DH discontinuity padding prepended to the DH concatenation for X25519
export const X3DH_PAD_BYTE = 0xff
