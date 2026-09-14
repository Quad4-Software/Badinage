// @quad4-software/badinage-omemo: permissively licensed (0BSD) OMEMO implementation.
// Supports the current urn:xmpp:omemo:2 profile of XEP-0384 and the legacy
// eu.siacs.conversations.axolotl profile (XEP-0384 0.3.0).

export {
  NS_OMEMO2,
  NS_OMEMO2_DEVICES,
  NS_OMEMO2_BUNDLES,
  NS_LEGACY,
  NS_LEGACY_DEVICELIST,
  NS_LEGACY_BUNDLES,
  NS_SCE,
  NS_JABBER_CLIENT,
  NAMESPACES,
  MAX_SKIP,
  MAX_SKIPPED_KEYS,
  HEARTBEAT_THRESHOLD,
  PREKEY_COUNT_DEFAULT,
  PREKEY_COUNT_MIN_OMEMO2,
  PREKEY_COUNT_MIN_LEGACY,
  DEVICE_ID_MAX
} from './constants'
export type { Namespace } from './constants'

export {
  OmemoError,
  ProtocolError,
  DecryptionFailedError,
  AuthenticationError,
  KeyExchangeError,
  InvalidSignatureError,
  MissingPreKeyError,
  DoSProtectionError,
  DuplicateMessageError,
  ParseError
} from './errors'

export {
  concatBytes,
  bytesEqual,
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  bytesToUtf8,
  randomBytes,
  base64Encode,
  base64Decode
} from './internal/bytes'
export { el, findChild, childrenNamed, parseXml, serializeXml, escapeXml } from './internal/xml'
export type { XmlElement } from './internal/xml'
export {
  ProtoWriter,
  readFields,
  getVarint,
  getBytes,
  requireVarint,
  requireBytes
} from './internal/protobuf'
export type { ProtoField } from './internal/protobuf'

export {
  generateX25519KeyPair,
  generateEd25519KeyPair,
  generateCurve25519Identity,
  clampCurve25519Secret,
  x25519SharedSecret,
  edSecretToCurveSecret,
  edPublicToCurvePublic,
  curvePublicToEdPublic,
  curveSecretSignBit,
  encodeCurveKeyWire,
  decodeCurveKeyWire
} from './crypto/keys'
export type { KeyPair } from './crypto/keys'
export { hkdfSha256, hmacSha256, sha256, sha512, chainMessageKey } from './crypto/kdf'
export {
  aes256CbcEncrypt,
  aes256CbcDecrypt,
  aes128GcmEncrypt,
  aes128GcmDecrypt
} from './crypto/aes'
export type { GcmResult } from './crypto/aes'
export { xed25519Sign, xed25519Verify } from './crypto/xed25519'
export type { XedVerifyResult } from './crypto/xed25519'

export {
  encodeOmemoMessage,
  decodeOmemoMessage,
  encodeAuthenticatedMessage,
  decodeAuthenticatedMessage,
  encodeKeyExchange,
  decodeKeyExchange,
  encodeBundle,
  decodeBundle
} from './protocol/wire/messages'
export type {
  OmemoMessage,
  OmemoAuthenticatedMessage,
  OmemoKeyExchange,
  OmemoBundle,
  BundlePreKey
} from './protocol/wire/messages'
export { PROFILES, marshalMessage, unmarshalMessage } from './protocol/wire/profiles'
export type { WireProfile } from './protocol/wire/profiles'
export { x3dhInitiate, x3dhRespond } from './protocol/session/x3dh'
export type {
  IdentityMaterial,
  X3dhActiveResult,
  X3dhPassiveInput,
  X3dhPassiveResult
} from './protocol/session/x3dh'
export { Session, DEFAULT_LIMITS, deriveMessageKeyMaterial } from './protocol/session/session'
export type {
  SessionState,
  EncryptResult,
  PendingKeyExchange,
  SkippedKey,
  RatchetLimits
} from './protocol/session/session'
export { serializeSession, deserializeSession } from './protocol/session/sessionData'
export { sessionInitiator, sessionResponder } from './protocol/session/sessionInit'
export type { SessionData } from './protocol/session/sessionData'
export { buildBundleElement, serializeBundle, parseBundle } from './protocol/wire/bundle'
export type { ParsedBundle, OwnBundle } from './protocol/wire/bundle'
export {
  encodeKeyExchangeWire,
  decodeKeyExchangeWire,
  looksLikeKeyExchange
} from './protocol/wire/keyExchange'
export type { ParsedKeyExchange } from './protocol/wire/keyExchange'
export {
  encryptPayloadOmemo2,
  decryptPayloadOmemo2,
  encryptPayloadLegacy,
  decryptPayloadLegacy,
  emptyKeyMaterialPlaintext
} from './protocol/wire/messageCrypto'
export type { Omemo2PayloadResult, LegacyPayloadResult } from './protocol/wire/messageCrypto'
export {
  buildSceEnvelope,
  serializeSceEnvelope,
  parseSceEnvelope,
  textEnvelope,
  bodyText
} from './protocol/wire/sce'
export type { SceEnvelopeInput, ParsedSceEnvelope } from './protocol/wire/sce'
export {
  buildEncryptedElement,
  serializeEncrypted,
  parseEncryptedElement,
  buildDeviceListElement,
  serializeDeviceList,
  parseDeviceList
} from './protocol/wire/encrypted'
export type { WireKey, ParsedEncrypted, EncryptOutputKey } from './protocol/wire/encrypted'

export { sessionKey } from './store/interface'
export type {
  OmemoStore,
  IdentityRecord,
  SignedPreKeyRecord,
  DeviceRecord
} from './store/interface'
export { InMemoryOmemoStore } from './store/memory'

export {
  identityFingerprintMaterial,
  identityFingerprintFromWire,
  formatFingerprint,
  bundleFingerprint,
  fingerprintsEqual,
  safetyNumber
} from './trust'

export { OmemoManager, encryptedElementFromXml, legacyIdentitySignBit } from './manager'
export type { OmemoManagerConfig, EncryptRecipient, EncryptInput, DecryptResult } from './manager'
