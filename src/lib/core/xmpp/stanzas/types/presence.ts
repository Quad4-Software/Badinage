// Presence and MUC stanza shapes: presence updates, occupants, presence
// errors and the invite/decline pair.

import type { CapsRef } from './meta'

export interface PresenceUpdate {
  from: string
  show: string
  status: string
  type?: string | undefined
  // XEP-0115 entity capabilities advertised in the c element
  caps?: CapsRef | undefined
  // XEP-0153 vcard-temp:x:update photo hash. The empty string means the
  // contact explicitly advertises no avatar, undefined means no update
  // element was present and the cached avatar stays untouched
  avatarHash?: string | undefined
}

export interface MucOccupant {
  room: string
  nick: string
  presence: string
  affiliation: string
  role: string
  self: boolean
  codes: string[]
  // real jid, only exposed by non-anonymous rooms via the item jid attr
  jid?: string | undefined
  // XEP-0421 stable id attached to occupant presence
  occupantId?: string | undefined
  // the item nick attribute on a 303 nick-change broadcast
  newNick?: string | undefined
  // kick or ban reason from the item reason element, or the status text
  reason?: string | undefined
  caps?: CapsRef | undefined
  avatarHash?: string | undefined
}

// Presence type=error carrying an RFC 6120 stanza error. On the room
// join path this is how 401/403/404/407/409 failures arrive.
export interface PresenceError {
  from: string
  code?: string | undefined
  condition?: string | undefined
  text?: string | undefined
}

// XEP-0249 direct invite or XEP-0045 mediated invite arriving as a
// message stanza.
export interface MucInvite {
  room: string
  // the inviter: stanza from for direct invites, the invite from
  // attribute for mediated ones
  from: string
  kind: 'direct' | 'mediated'
  password?: string | undefined
  reason?: string | undefined
  // XEP-0249 continue flag: the room continues an existing 1:1 thread
  continueSession?: boolean | undefined
}

// XEP-0045 mediated decline, relayed by the room.
export interface MucDecline {
  room: string
  from: string
  reason?: string | undefined
}
