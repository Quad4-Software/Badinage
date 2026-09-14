// XEP-0166 jingle wire types: the parsed form of a jingle iq plus the
// content, transport and reason shapes session-initiate, accept and
// transport-info carry. Kept free of DOM and strophe types so the
// session layer and tests can treat them as plain data.

export type JingleAction =
  | 'session-initiate'
  | 'session-accept'
  | 'session-terminate'
  | 'session-info'
  | 'transport-info'
  | 'content-add'
  | 'content-accept'
  | 'content-modify'
  | 'content-reject'
  | 'content-remove'
  | 'transport-accept'
  | 'transport-reject'
  | 'transport-replace'

// the terminate reasons a call ui needs to distinguish. The full xep
// registry is wider. Anything unrecognized falls back to the raw tag
// name so the reason still surfaces in logs and toasts
export type JingleReason =
  | 'success'
  | 'decline'
  | 'busy'
  | 'cancel'
  | 'timeout'
  | 'failed-transport'
  | 'failed-application'
  | 'incompatible-parameters'
  | 'unsupported-transports'
  | 'unsupported-applications'
  | 'unknown-session'
  | 'expired'
  | 'connectivity-error'
  | 'media-error'
  | 'general-error'
  | 'security-required'
  | 'alternative-session'
  | 'gone'

export type JingleSender = 'initiator' | 'responder' | 'both' | 'none'

export interface JinglePayload {
  id: string
  name: string
  clockrate: string
  channels?: string | undefined
  // a=fmtp parameter string kept verbatim, for opus inband fec and
  // the profile/level hints video codecs need
  params?: string | undefined
}

export interface JingleCandidate {
  foundation: string
  component: string
  protocol: string
  priority: string
  ip: string
  port: string
  type: string
  relAddr?: string | undefined
  relPort?: string | undefined
  generation: string
  network: string
  id?: string | undefined
}

export interface JingleTransport {
  ufrag?: string | undefined
  pwd?: string | undefined
  fingerprint?: { hash: string; setup: string; value: string } | undefined
  candidates: JingleCandidate[]
}

export interface JingleContent {
  name: string
  // empty on transport-info trickle contents, which carry no
  // description element - only candidates
  media?: 'audio' | 'video' | undefined
  creator: 'initiator' | 'responder'
  senders: JingleSender
  payloads: JinglePayload[]
  transport: JingleTransport
}

export interface JinglePacket {
  action: JingleAction
  sid: string
  // full jid the iq came from - the session peer
  from: string
  initiator?: string | undefined
  responder?: string | undefined
  contents: JingleContent[]
  // terminate carries one reason child, session-info carries a single
  // info element like ringing or active
  reason?: string | undefined
  info?: string | undefined
}
