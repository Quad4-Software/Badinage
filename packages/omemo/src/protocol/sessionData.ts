// JSON serialization of session state for storage. Byte strings are base64.

import type { Namespace } from '../constants'
import { ParseError } from '../errors'
import { base64Decode, base64Encode } from '../internal/bytes'
import { PROFILES } from './profiles'
import { DEFAULT_LIMITS, Session } from './session'
import type { RatchetLimits, SessionState } from './session'

export interface SessionData {
  v: 1
  namespace: Namespace
  initiation: 'active' | 'passive'
  rk: string
  cks: string | null
  ckr: string | null
  dhsPriv: string
  dhsPub: string
  dhr: string | null
  ns: number
  nr: number
  pn: number
  ad: string
  remoteIdentity: string
  localIdentity: string
  pendingKeyExchange: { pkId: number; spkId: number; ik: string; ek: string } | null
  skipped: { dh: string; n: number; mk: string }[]
  confirmed: boolean
}

export function serializeSession(session: Session): SessionData {
  const s = session.state
  return {
    v: 1,
    namespace: session.namespace,
    initiation: s.initiation,
    rk: base64Encode(s.rk),
    cks: s.cks === null ? null : base64Encode(s.cks),
    ckr: s.ckr === null ? null : base64Encode(s.ckr),
    dhsPriv: base64Encode(s.dhs.privateKey),
    dhsPub: base64Encode(s.dhs.publicKey),
    dhr: s.dhr === null ? null : base64Encode(s.dhr),
    ns: s.ns,
    nr: s.nr,
    pn: s.pn,
    ad: base64Encode(s.ad),
    remoteIdentity: base64Encode(s.remoteIdentity),
    localIdentity: base64Encode(s.localIdentity),
    pendingKeyExchange:
      s.pendingKeyExchange === null
        ? null
        : {
            pkId: s.pendingKeyExchange.pkId,
            spkId: s.pendingKeyExchange.spkId,
            ik: base64Encode(s.pendingKeyExchange.ik),
            ek: base64Encode(s.pendingKeyExchange.ek)
          },
    skipped: s.skipped.map((entry) => ({
      dh: base64Encode(entry.dh),
      n: entry.n,
      mk: base64Encode(entry.mk)
    })),
    confirmed: s.confirmed
  }
}

export function deserializeSession(
  data: SessionData,
  limits: RatchetLimits = DEFAULT_LIMITS
): Session {
  if (data.v !== 1) throw new ParseError('unsupported session version')
  const profile = PROFILES[data.namespace]
  const state: SessionState = {
    initiation: data.initiation,
    rk: base64Decode(data.rk),
    cks: data.cks === null ? null : base64Decode(data.cks),
    ckr: data.ckr === null ? null : base64Decode(data.ckr),
    dhs: {
      privateKey: base64Decode(data.dhsPriv),
      publicKey: base64Decode(data.dhsPub)
    },
    dhr: data.dhr === null ? null : base64Decode(data.dhr),
    ns: data.ns,
    nr: data.nr,
    pn: data.pn,
    ad: base64Decode(data.ad),
    remoteIdentity: base64Decode(data.remoteIdentity),
    localIdentity: base64Decode(data.localIdentity),
    pendingKeyExchange:
      data.pendingKeyExchange === null
        ? null
        : {
            pkId: data.pendingKeyExchange.pkId,
            spkId: data.pendingKeyExchange.spkId,
            ik: base64Decode(data.pendingKeyExchange.ik),
            ek: base64Decode(data.pendingKeyExchange.ek)
          },
    skipped: data.skipped.map((entry) => ({
      dh: base64Decode(entry.dh),
      n: entry.n,
      mk: base64Decode(entry.mk)
    })),
    confirmed: data.confirmed
  }
  return new Session(profile, state, limits)
}
