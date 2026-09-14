// XEP-0115 entity capabilities plus the advertised feature registry.
//
// DISCO_FEATURES is the single registry of everything this client
// advertises: it feeds both the disco#info answers we send and the caps
// verification string in outgoing presence. Streams adding wire support
// (OMEMO, push notifications) must append their namespaces here so the
// published hash tracks the real feature set. Changing this list changes
// the advertised ver, which is exactly what caps is for.

import { CAPS_NODE } from '$lib/constants'
import { sha1Base64Utf8 } from '$lib/utils/protocol/sha1'

import { NS } from '../ns'
import type { CapsRef, DiscoForm, DiscoIdentity } from '../stanzas'

export const DISCO_IDENTITY: DiscoIdentity = {
  category: 'client',
  type: 'web',
  name: 'Badinage'
}

export const DISCO_FEATURES: readonly string[] = [
  NS.DISCO_INFO,
  NS.DISCO_ITEMS,
  NS.CAPS,
  NS.MUC,
  NS.MAM,
  NS.CARBONS,
  NS.CHAT_STATES,
  NS.RECEIPTS,
  NS.MARKERS,
  NS.REPLY,
  NS.REACTIONS,
  NS.CORRECT,
  NS.STANZA_IDS,
  NS.BLOCKING,
  NS.VCARD_TEMP,
  NS.VCARD_UPDATE,
  NS.HTTP_UPLOAD,
  NS.EME,
  NS.BOOKMARKS,
  NS.ATTENTION,
  NS.RTT,
  NS.GEOLOC,
  NS.EPHEMERAL,
  // XEP-0166/0167/0176: jingle rtp calls over ice-udp. Advertising is
  // what lets peers offer us audio and video sessions
  NS.JINGLE,
  NS.JINGLE_RTP,
  NS.JINGLE_RTP_AUDIO,
  NS.JINGLE_RTP_VIDEO,
  NS.JINGLE_ICE,
  // PEP auto-subscription: advertising +notify makes the server send us
  // bookmark and displayed-marker changes made by our other clients
  `${NS.BOOKMARKS}+notify`,
  `${NS.MDS}+notify`
]

// i;octet collation (RFC 4790 9.3): code point order, which utf-16
// string comparison matches for everything involved here
function byOctet(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// XEP-0115 verification string: sorted identity category/type/lang/name,
// sorted feature vars, then sorted extension forms (form type, then each
// field var with sorted values), everything delimited by '<' and hashed
// with sha1 in base64.
export function capsVerificationString(
  identities: DiscoIdentity[],
  features: readonly string[],
  forms: DiscoForm[] = []
): string {
  let s = ''
  const ids = identities
    .map((i) => `${i.category}/${i.type}/${i.lang ?? ''}/${i.name ?? ''}`)
    .sort(byOctet)
  for (const id of ids) s += `${id}<`
  for (const feature of [...features].sort(byOctet)) s += `${feature}<`
  for (const form of [...forms].sort((a, b) => byOctet(a.formType, b.formType))) {
    s += `${form.formType}<`
    for (const field of [...form.fields].sort((a, b) => byOctet(a.var, b.var))) {
      s += `${field.var}<`
      for (const value of [...field.values].sort(byOctet)) s += `${value}<`
    }
  }
  return sha1Base64Utf8(s)
}

let ownVer: string | undefined

// Our own caps descriptor for outgoing presence. The ver is computed
// once because the advertised set is static for the session.
export function ownCaps(): CapsRef {
  ownVer ??= capsVerificationString([DISCO_IDENTITY], DISCO_FEATURES)
  return { node: CAPS_NODE, hash: 'sha-1', ver: ownVer }
}
