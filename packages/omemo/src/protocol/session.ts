// The Double Ratchet session per XEP-0384. Both profiles share the same
// ratchet structure; they differ in KDF info strings, MAC size, wire encoding
// of header keys and associated-data ordering, all handled by WireProfile.
// Serialization lives in sessionData.ts.

import { CURVE_KEY_SIZE, KEY_MATERIAL_SIZE, MAX_SKIP, MAX_SKIPPED_KEYS } from '../constants'
import type { Namespace } from '../constants'
import {
  AuthenticationError,
  DoSProtectionError,
  DuplicateMessageError,
  ParseError,
  ProtocolError
} from '../errors'
import { bytesEqual, concatBytes } from '../internal/bytes'
import { aes256CbcDecrypt, aes256CbcEncrypt } from '../crypto/aes'
import { chainMessageKey, hkdfSha256, hmacSha256 } from '../crypto/kdf'
import { generateX25519KeyPair, x25519SharedSecret } from '../crypto/keys'
import type { KeyPair } from '../crypto/keys'
import { marshalMessage, unmarshalMessage } from './profiles'
import type { WireProfile } from './profiles'
import { decodeOmemoMessage, encodeOmemoMessage } from './messages'

export interface RatchetLimits {
  maxSkip: number
  maxSkippedKeys: number
}

export const DEFAULT_LIMITS: RatchetLimits = {
  maxSkip: MAX_SKIP,
  maxSkippedKeys: MAX_SKIPPED_KEYS
}

export interface PendingKeyExchange {
  pkId: number
  spkId: number
  ik: Uint8Array
  ek: Uint8Array
}

export interface SkippedKey {
  dh: Uint8Array
  n: number
  mk: Uint8Array
}

// Mutable state container. Exposed so sessionData.ts can serialize sessions
// without reaching into private fields.
export interface SessionState {
  initiation: 'active' | 'passive'
  rk: Uint8Array
  cks: Uint8Array | null
  ckr: Uint8Array | null
  dhs: KeyPair
  dhr: Uint8Array | null
  ns: number
  nr: number
  pn: number
  ad: Uint8Array
  remoteIdentity: Uint8Array
  localIdentity: Uint8Array
  pendingKeyExchange: PendingKeyExchange | null
  // The key exchange this session was passively built from, if any. Used to
  // recognize retransmitted key exchanges (the reference implementation calls
  // this builds_same_session) so that a replayed key exchange does not
  // clobber an established session.
  receivedKeyExchange?: PendingKeyExchange | null
  skipped: SkippedKey[]
  confirmed: boolean
}

export interface EncryptResult {
  wire: Uint8Array
  keyExchange: PendingKeyExchange | null
}

export function emptySessionState(): SessionState {
  return {
    initiation: 'active',
    rk: new Uint8Array(0),
    cks: null,
    ckr: null,
    dhs: generateX25519KeyPair(),
    dhr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    ad: new Uint8Array(0),
    remoteIdentity: new Uint8Array(0),
    localIdentity: new Uint8Array(0),
    pendingKeyExchange: null,
    receivedKeyExchange: null,
    skipped: [],
    confirmed: false
  }
}

// Derive the 80 bytes of key material from a message key: 32 byte encryption
// key, 32 byte authentication key, 16 byte IV. Shared by encrypt and decrypt.
export function deriveMessageKeyMaterial(
  profile: WireProfile,
  messageKey: Uint8Array
): { enc: Uint8Array; auth: Uint8Array; iv: Uint8Array } {
  const out = hkdfSha256(messageKey, undefined, profile.infoMk, KEY_MATERIAL_SIZE)
  return { enc: out.slice(0, 32), auth: out.slice(32, 64), iv: out.slice(64, 80) }
}

export class Session {
  readonly namespace: Namespace
  private readonly profile: WireProfile
  private readonly limits: RatchetLimits
  private readonly s: SessionState

  constructor(profile: WireProfile, state: SessionState, limits: RatchetLimits = DEFAULT_LIMITS) {
    this.profile = profile
    this.namespace = profile.namespace
    this.limits = limits
    this.s = state
  }

  static empty(profile: WireProfile, limits: RatchetLimits = DEFAULT_LIMITS): Session {
    return new Session(profile, emptySessionState(), limits)
  }

  get state(): SessionState {
    return this.s
  }

  get confirmed(): boolean {
    return this.s.confirmed
  }

  get remoteIdentityKey(): Uint8Array {
    return this.s.remoteIdentity
  }

  get initiation(): 'active' | 'passive' {
    return this.s.initiation
  }

  private dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    return x25519SharedSecret(privateKey, publicKey)
  }

  private kdfRoot(
    rootKey: Uint8Array,
    dhOutput: Uint8Array
  ): { rootKey: Uint8Array; chainKey: Uint8Array } {
    const out = hkdfSha256(dhOutput, rootKey, this.profile.infoRoot, CURVE_KEY_SIZE * 2)
    return { rootKey: out.slice(0, CURVE_KEY_SIZE), chainKey: out.slice(CURVE_KEY_SIZE) }
  }

  private deriveMessageKeys(messageKey: Uint8Array): {
    enc: Uint8Array
    auth: Uint8Array
    iv: Uint8Array
  } {
    return deriveMessageKeyMaterial(this.profile, messageKey)
  }

  encrypt(plaintext: Uint8Array): EncryptResult {
    if (this.s.cks === null) throw new ProtocolError('no sending chain')
    const { nextChainKey, messageKey } = chainMessageKey(this.s.cks)
    const keys = this.deriveMessageKeys(messageKey)
    const ciphertext = aes256CbcEncrypt(keys.enc, keys.iv, plaintext)
    const message = marshalMessage(
      this.profile,
      encodeOmemoMessage(
        {
          n: this.s.ns,
          pn: this.s.pn,
          dhPub: this.profile.encodeHeaderKey(this.s.dhs.publicKey),
          ciphertext
        },
        this.profile.namespace
      )
    )
    const ad = this.profile.adForSender(this.s.initiation, this.s.ad)
    const mac = hmacSha256(keys.auth, concatBytes(ad, message)).slice(0, this.profile.macSize)
    this.s.cks = nextChainKey
    this.s.ns += 1
    return {
      wire: this.profile.seal(mac, message),
      keyExchange: this.s.confirmed ? null : this.s.pendingKeyExchange
    }
  }

  decrypt(wire: Uint8Array): Uint8Array {
    // Work on a copy of the state so that a failed decryption leaves the
    // session untouched: a malformed or forged message must not advance the
    // ratchet, consume skipped keys, or rotate the sending key pair. The
    // reference implementation follows the same pattern of only committing
    // ratchet state changes after successful authentication.
    const work: SessionState = { ...this.s, skipped: [...this.s.skipped] }
    const plaintext = this.decryptWith(work, wire)
    work.confirmed = true
    Object.assign(this.s, work)
    return plaintext
  }

  private decryptWith(s: SessionState, wire: Uint8Array): Uint8Array {
    const { mac, messageBytes } = this.profile.open(wire)
    const parsed = decodeOmemoMessage(
      unmarshalMessage(this.profile, messageBytes),
      this.profile.namespace
    )
    const dhPub = this.profile.decodeHeaderKey(parsed.dhPub)
    const ad = this.profile.adForRecipient(s.initiation, s.ad)

    let messageKey = this.takeSkipped(s, dhPub, parsed.n)
    if (messageKey === undefined) {
      if (s.dhr === null || !bytesEqual(dhPub, s.dhr)) {
        // Skips inside the old chain are bounded by the DoS threshold. If the
        // announced gap is larger the keys are not computed, matching the
        // reference behavior which keeps the ratchet able to recover.
        if (s.ckr !== null && parsed.pn - s.nr <= this.limits.maxSkip) {
          this.skipMessageKeys(s, parsed.pn)
        }
        this.dhRatchet(s, dhPub)
      }
      this.skipMessageKeys(s, parsed.n)
      if (parsed.n < s.nr || s.ckr === null) {
        throw new DuplicateMessageError('message already decrypted')
      }
      const step = chainMessageKey(s.ckr)
      s.ckr = step.nextChainKey
      messageKey = step.messageKey
      s.nr += 1
    }

    const keys = this.deriveMessageKeys(messageKey)
    const expectedMac = hmacSha256(keys.auth, concatBytes(ad, messageBytes)).slice(
      0,
      this.profile.macSize
    )
    if (!bytesEqual(expectedMac, mac)) {
      throw new AuthenticationError('message authentication failed')
    }
    if (parsed.ciphertext === undefined) throw new ParseError('missing ciphertext')
    return aes256CbcDecrypt(keys.enc, keys.iv, parsed.ciphertext)
  }

  private takeSkipped(s: SessionState, dhPub: Uint8Array, n: number): Uint8Array | undefined {
    const index = s.skipped.findIndex((entry) => entry.n === n && bytesEqual(entry.dh, dhPub))
    if (index < 0) return undefined
    const [entry] = s.skipped.splice(index, 1)
    return entry?.mk
  }

  private dhRatchet(s: SessionState, remotePublic: Uint8Array): void {
    // The root chain step happens before touching the state so an invalid
    // remote key (for example a low order point) cannot leave the session in
    // a half ratcheted state.
    const receiving = this.kdfRoot(s.rk, this.dh(s.dhs.privateKey, remotePublic))
    const nextKeyPair = generateX25519KeyPair()
    const sending = this.kdfRoot(receiving.rootKey, this.dh(nextKeyPair.privateKey, remotePublic))
    s.dhr = remotePublic
    s.rk = sending.rootKey
    s.ckr = receiving.chainKey
    s.pn = s.ns
    s.ns = 0
    s.nr = 0
    s.dhs = nextKeyPair
    s.cks = sending.chainKey
  }

  // Advance the receiving chain up to n, storing skipped message keys. Called
  // before a DH ratchet step with the sender announced previous chain length,
  // and when walking to the announced chain index.
  private skipMessageKeys(s: SessionState, until: number): void {
    if (s.ckr === null || s.dhr === null) return
    const gap = until - s.nr
    if (gap <= 0) return
    if (gap > this.limits.maxSkip) {
      throw new DoSProtectionError(`message gap ${gap} exceeds limit ${this.limits.maxSkip}`)
    }
    for (let i = 0; i < gap; i++) {
      const step = chainMessageKey(s.ckr)
      s.ckr = step.nextChainKey
      s.skipped.push({ dh: s.dhr, n: s.nr, mk: step.messageKey })
      s.nr += 1
    }
    while (s.skipped.length > this.limits.maxSkippedKeys) s.skipped.shift()
  }
}
