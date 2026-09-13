// Session construction after X3DH, for both the initiating and the
// responding side.

import { CURVE_KEY_SIZE } from '../../constants'
import { hkdfSha256 } from '../../crypto/kdf'
import { generateX25519KeyPair, x25519SharedSecret } from '../../crypto/keys'
import type { KeyPair } from '../../crypto/keys'
import type { WireProfile } from '../wire/profiles'
import { DEFAULT_LIMITS, Session } from './session'
import type { PendingKeyExchange, RatchetLimits } from './session'

function kdfRoot(
  profile: WireProfile,
  rootKey: Uint8Array,
  dhOutput: Uint8Array
): { rootKey: Uint8Array; chainKey: Uint8Array } {
  const out = hkdfSha256(dhOutput, rootKey, profile.infoRoot, CURVE_KEY_SIZE * 2)
  return { rootKey: out.slice(0, CURVE_KEY_SIZE), chainKey: out.slice(CURVE_KEY_SIZE) }
}

// Active initiation: shared secret from X3DH, the responder signed pre key
// public is the initial remote ratchet key.
export function sessionInitiator(
  profile: WireProfile,
  args: {
    sharedSecret: Uint8Array
    associatedData: Uint8Array
    responderRatchetPublic: Uint8Array
    localIdentity: Uint8Array
    remoteIdentity: Uint8Array
    keyExchange: PendingKeyExchange
  },
  limits: RatchetLimits = DEFAULT_LIMITS
): Session {
  const session = Session.empty(profile, limits)
  const s = session.state
  s.initiation = 'active'
  s.rk = args.sharedSecret
  s.ad = args.associatedData
  s.localIdentity = args.localIdentity
  s.remoteIdentity = args.remoteIdentity
  s.dhr = args.responderRatchetPublic
  s.dhs = generateX25519KeyPair()
  const { rootKey, chainKey } = kdfRoot(profile, s.rk, x25519SharedSecret(s.dhs.privateKey, s.dhr))
  s.rk = rootKey
  s.cks = chainKey
  s.pendingKeyExchange = args.keyExchange
  return session
}

// Passive initiation: shared secret from X3DH. The own signed pre key pair
// is the initial ratchet key pair; the first incoming message performs a
// DH ratchet step against the ratchet public key in its header, which
// derives the receiving chain and a fresh sending chain.
export function sessionResponder(
  profile: WireProfile,
  args: {
    sharedSecret: Uint8Array
    associatedData: Uint8Array
    ownRatchet: KeyPair
    localIdentity: Uint8Array
    remoteIdentity: Uint8Array
    // The key exchange the session was built from. Stored so a retransmitted
    // key exchange can be recognized instead of replacing the session.
    keyExchange?: PendingKeyExchange
  },
  limits: RatchetLimits = DEFAULT_LIMITS
): Session {
  const session = Session.empty(profile, limits)
  const s = session.state
  s.initiation = 'passive'
  s.rk = args.sharedSecret
  s.ad = args.associatedData
  s.localIdentity = args.localIdentity
  s.remoteIdentity = args.remoteIdentity
  s.dhs = args.ownRatchet
  s.receivedKeyExchange = args.keyExchange ?? null
  return session
}
