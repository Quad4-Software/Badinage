// OmemoManager: the high level facade tying bundles, X3DH, sessions and the
// wire format together. One manager handles one profile (omemo:2 or legacy)
// for one local device. Key material helpers live in
// protocol/session/deviceKeys.ts.

import { DEVICE_ID_MAX, PREKEY_COUNT_DEFAULT } from './constants'
import type { Namespace } from './constants'
import { DecryptionFailedError, KeyExchangeError, ParseError } from './errors'
import { bytesEqual, randomBytes } from './internal/bytes'
import { parseXml } from './internal/xml'
import type { XmlElement } from './internal/xml'

import { curveSecretSignBit, encodeCurveKeyWire, generateX25519KeyPair } from './crypto/keys'
import { parseBundle } from './protocol/wire/bundle'
import type { ParsedBundle } from './protocol/wire/bundle'
import {
  buildOwnBundle,
  ensureIdentity,
  generateSignedPreKey,
  requireIdentity,
  respondToKeyExchange
} from './protocol/session/deviceKeys'
import { decodeKeyExchangeWire, encodeKeyExchangeWire } from './protocol/wire/keyExchange'
import type { ParsedKeyExchange } from './protocol/wire/keyExchange'
import {
  decryptPayloadLegacy,
  decryptPayloadOmemo2,
  emptyKeyMaterialPlaintext,
  encryptPayloadLegacy,
  encryptPayloadOmemo2
} from './protocol/wire/messageCrypto'
import { PROFILES } from './protocol/wire/profiles'
import { DEFAULT_LIMITS } from './protocol/session/session'
import { sessionInitiator } from './protocol/session/sessionInit'
import type { PendingKeyExchange, RatchetLimits, Session } from './protocol/session/session'
import { deserializeSession, serializeSession } from './protocol/session/sessionData'
import { x3dhInitiate } from './protocol/session/x3dh'
import { buildEncryptedElement, parseEncryptedElement } from './protocol/wire/encrypted'
import type { EncryptOutputKey, ParsedEncrypted } from './protocol/wire/encrypted'
import type { OmemoStore } from './store/interface'

export interface OmemoManagerConfig {
  namespace: Namespace
  store: OmemoStore
  ownJid: string
  deviceId?: number
  limits?: RatchetLimits
  signedPreKeyId?: number
  preKeyCount?: number
}

export interface EncryptRecipient {
  jid: string
  deviceId: number
  // Optional bundle used to initiate a session when none exists yet.
  bundle?: ParsedBundle
}

export interface EncryptInput {
  recipients: EncryptRecipient[]
  // omemo:2: serialized SCE envelope. legacy: raw message text.
  plaintext?: Uint8Array
  // Produce a heartbeat/empty element with no payload.
  empty?: boolean
}

export interface DecryptResult {
  // Raw decrypted payload bytes. For omemo:2 this is the serialized SCE
  // envelope; for legacy the message text.
  plaintext: Uint8Array | undefined
  empty: boolean
  sid: number
  wasKeyExchange: boolean
  senderIdentityKey: Uint8Array | undefined
}

export class OmemoManager {
  readonly namespace: Namespace
  readonly ownJid: string
  readonly deviceId: number
  private readonly store: OmemoStore
  private readonly limits: RatchetLimits
  private readonly profile = () => PROFILES[this.namespace]

  private constructor(config: OmemoManagerConfig) {
    this.namespace = config.namespace
    this.store = config.store
    this.ownJid = config.ownJid
    this.deviceId = config.deviceId ?? OmemoManager.randomDeviceId()
    this.limits = config.limits ?? DEFAULT_LIMITS
  }

  static randomDeviceId(): number {
    return (randomBytes(4).reduce((acc, byte) => ((acc << 8) | byte) >>> 0, 0) % DEVICE_ID_MAX) + 1
  }

  // Generate or load identity material plus a signed pre key and the given
  // number of one-time pre keys.
  static async create(config: OmemoManagerConfig): Promise<OmemoManager> {
    const manager = new OmemoManager(config)
    await ensureIdentity(manager.store, manager.namespace)
    if ((await manager.store.listSignedPreKeyIds()).length === 0) {
      await generateSignedPreKey(manager.store, manager.namespace, config.signedPreKeyId ?? 0)
    }
    const wanted = config.preKeyCount ?? PREKEY_COUNT_DEFAULT
    const existing = await manager.store.listPreKeyIds()
    for (let i = 0; i < wanted - existing.length; i++) {
      await manager.store.putPreKey(i + existing.length, generateX25519KeyPair())
    }
    return manager
  }

  // Rotate the signed pre key. Old signed pre keys stay in the store so
  // delayed key exchange messages still resolve.
  async rotateSignedPreKey(id: number): Promise<void> {
    await generateSignedPreKey(this.store, this.namespace, id)
  }

  async buildBundle(): Promise<XmlElement> {
    return buildOwnBundle(this.store, this.namespace, this.deviceId)
  }

  // Parse a bundle element into a ParsedBundle with signature verification.
  parseBundle(element: XmlElement): ParsedBundle {
    return parseBundle(element, this.namespace)
  }

  private async loadSession(jid: string, deviceId: number): Promise<Session | undefined> {
    const data = await this.store.getSession(jid, deviceId)
    return data === undefined ? undefined : deserializeSession(data, this.limits)
  }

  private async saveSession(jid: string, deviceId: number, session: Session): Promise<void> {
    await this.store.putSession(jid, deviceId, serializeSession(session))
  }

  // Actively initiate a session from a peer bundle.
  async initiateSession(jid: string, deviceId: number, bundle: ParsedBundle): Promise<Session> {
    const identity = await requireIdentity(this.store)
    const result = x3dhInitiate(this.profile(), identity, bundle)
    const session = sessionInitiator(
      this.profile(),
      {
        sharedSecret: result.sharedSecret,
        associatedData: result.associatedData,
        responderRatchetPublic: result.signedPreKeyPublic,
        localIdentity: identity.wirePublicKey,
        remoteIdentity: bundle.identityKeyWire,
        keyExchange: {
          pkId: result.preKeyId,
          spkId: result.signedPreKeyId,
          ik: identity.wirePublicKey,
          ek:
            this.namespace === 'legacy'
              ? encodeCurveKeyWire(result.ephemeral.publicKey)
              : result.ephemeral.publicKey
        }
      },
      this.limits
    )
    await this.saveSession(jid, deviceId, session)
    return session
  }

  private async sessionOrInitiate(recipient: EncryptRecipient): Promise<Session> {
    const existing = await this.loadSession(recipient.jid, recipient.deviceId)
    if (existing) return existing
    if (recipient.bundle === undefined) {
      throw new KeyExchangeError(
        `no session for ${recipient.jid}/${recipient.deviceId} and no bundle provided`
      )
    }
    return this.initiateSession(recipient.jid, recipient.deviceId, recipient.bundle)
  }

  async encrypt(input: EncryptInput): Promise<XmlElement> {
    const empty = input.empty === true || input.plaintext === undefined
    let transport: Uint8Array
    let payloadCiphertext: Uint8Array | undefined
    let iv: Uint8Array | undefined

    if (empty) {
      transport = emptyKeyMaterialPlaintext(this.namespace)
      if (this.namespace === 'legacy') iv = randomBytes(12)
    } else {
      const plaintext = input.plaintext as Uint8Array
      if (this.namespace === 'omemo2') {
        const result = encryptPayloadOmemo2(this.profile(), plaintext)
        transport = result.transportKeyMaterial
        payloadCiphertext = result.payloadCiphertext
      } else {
        const result = encryptPayloadLegacy(plaintext)
        transport = result.transportKeyMaterial
        payloadCiphertext = result.payloadCiphertext
        iv = result.iv
      }
    }

    const keys: EncryptOutputKey[] = []
    for (const recipient of input.recipients) {
      const session = await this.sessionOrInitiate(recipient)
      const encrypted = session.encrypt(transport)
      const data =
        encrypted.keyExchange === null
          ? encrypted.wire
          : encodeKeyExchangeWire(this.namespace, encrypted.keyExchange, encrypted.wire)
      keys.push({
        rid: recipient.deviceId,
        jid: recipient.jid,
        data,
        kex: encrypted.keyExchange !== null
      })
      await this.saveSession(recipient.jid, recipient.deviceId, session)
    }

    return buildEncryptedElement({
      namespace: this.namespace,
      sid: this.deviceId,
      keys,
      ...(payloadCiphertext !== undefined ? { payload: payloadCiphertext } : {}),
      ...(iv !== undefined ? { iv } : {})
    })
  }

  async decrypt(element: XmlElement, senderJid: string): Promise<DecryptResult> {
    const parsed = parseEncryptedElement(element, this.namespace)
    const key = this.selectKey(parsed)
    if (!key) throw new DecryptionFailedError('no key material for this device')

    // The jid attribute on a keys group names the recipient, not the sender.
    // Sessions are keyed by the sender JID plus the sender device id (sid).
    const sender = senderJid
    let session = await this.loadSession(sender, parsed.sid)
    let inner = key.data
    let wasKex = false

    let kex: ParsedKeyExchange | undefined
    if (key.kex) {
      wasKex = true
      kex = decodeKeyExchangeWire(this.namespace, key.data)
      inner = kex.message
      if (session === undefined) {
        session = await respondToKeyExchange(this.store, this.profile(), kex, this.limits)
      }
    }
    if (session === undefined) {
      throw new DecryptionFailedError(`no session for ${sender}/${parsed.sid}`)
    }

    let transport: Uint8Array
    try {
      transport = session.decrypt(inner)
    } catch (error) {
      // If the kex was resent or the sender re-initiated, the stored session
      // may not line up. Rebuild the session from the key exchange once.
      // Session state is only committed on successful decryption, so the
      // stored session is still intact here.
      if (kex === undefined) throw error
      const rebuilt = await respondToKeyExchange(this.store, this.profile(), kex, this.limits)
      transport = rebuilt.decrypt(inner)
      // A retransmission of the same key exchange keeps the established
      // session (the reference implementation calls this check
      // builds_same_session); only a key exchange with different parameters
      // replaces it.
      if (!sameKeyExchange(session.state.receivedKeyExchange ?? null, kex)) {
        session = rebuilt
      }
    }
    await this.saveSession(sender, parsed.sid, session)

    if (parsed.payload === undefined) {
      return {
        plaintext: undefined,
        empty: true,
        sid: parsed.sid,
        wasKeyExchange: wasKex,
        senderIdentityKey: session.remoteIdentityKey
      }
    }

    const plaintext =
      this.namespace === 'omemo2'
        ? decryptPayloadOmemo2(this.profile(), transport, parsed.payload)
        : decryptPayloadLegacy(transport, requireIv(parsed), parsed.payload)

    return {
      plaintext,
      empty: false,
      sid: parsed.sid,
      wasKeyExchange: wasKex,
      senderIdentityKey: session.remoteIdentityKey
    }
  }

  private selectKey(parsed: ParsedEncrypted) {
    // For omemo:2 keys are grouped per recipient bare JID; match both the
    // group JID (when present) and the rid. For legacy only the rid exists.
    return (
      parsed.keys.find(
        (key) => key.rid === this.deviceId && (key.jid === undefined || key.jid === this.ownJid)
      ) ?? parsed.keys.find((key) => key.rid === this.deviceId)
    )
  }
}

function requireIv(parsed: ParsedEncrypted): Uint8Array {
  if (parsed.iv === undefined) throw new ParseError('legacy message missing iv')
  return parsed.iv
}

function sameKeyExchange(received: PendingKeyExchange | null, kex: ParsedKeyExchange): boolean {
  return (
    received !== null &&
    received.pkId === kex.pkId &&
    received.spkId === kex.spkId &&
    bytesEqual(received.ik, kex.ik) &&
    bytesEqual(received.ek, kex.ek)
  )
}

export function encryptedElementFromXml(xml: string): XmlElement {
  return parseXml(xml)
}

export function legacyIdentitySignBit(privateKey: Uint8Array): 0 | 1 {
  return curveSecretSignBit(privateKey)
}
