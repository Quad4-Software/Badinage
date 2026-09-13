// <presence> parsing: availability updates, muc occupants, subscription
// asks, entity caps and avatar hashes.

import { bareJid, jidResource } from '$lib/utils/jid'
import { allNsTags, childElements, firstNsTag, firstTag, firstTagText } from '$lib/utils/xml'

import { NS } from '../ns'
import type { CapsRef, MucOccupant, PresenceError, PresenceUpdate } from './types'

// XEP-0115 c element on a presence stanza. Returns null when absent or
// missing the attributes needed to address a disco query.
export function parseCaps(stanza: Element): CapsRef | null {
  const c = firstNsTag(stanza, NS.CAPS, 'c')
  if (!c) return null
  const node = c.getAttribute('node')
  const hash = c.getAttribute('hash')
  const ver = c.getAttribute('ver')
  return node && hash && ver ? { node, hash, ver } : null
}

// XEP-0153 vcard-temp:x:update photo hash. Returns undefined when the
// presence carries no update element (keep the cached avatar), the empty
// string when the photo element is empty (explicitly no avatar), or the
// sha1 hex of the photo bytes.
export function parseAvatarHash(stanza: Element): string | undefined {
  const x = firstNsTag(stanza, NS.VCARD_UPDATE, 'x')
  if (!x) return undefined
  const photo = firstNsTag(x, NS.VCARD_UPDATE, 'photo')
  return photo ? (photo.textContent?.trim() ?? '') : ''
}

// Parse a <presence> stanza. Returns one of three shapes: an occupant update
// for MUC, a subscription request, or a plain presence update.

export function parsePresence(
  stanza: Element
):
  | { kind: 'occupant'; occupant: MucOccupant }
  | { kind: 'subscribe'; from: string; status: string }
  | { kind: 'presence'; presence: PresenceUpdate }
  | { kind: 'presenceError'; error: PresenceError }
  | null {
  const from = stanza.getAttribute('from')
  if (!from) return null
  const type = stanza.getAttribute('type')
  const caps = parseCaps(stanza)
  const avatarHash = parseAvatarHash(stanza)

  const mucUser = firstNsTag(stanza, NS.MUC_USER, 'x')
  if (mucUser) {
    const item = firstNsTag(mucUser, NS.MUC_USER, 'item')
    const codes = allNsTags(mucUser, NS.MUC_USER, 'status').map((s) => s.getAttribute('code') ?? '')
    const occupant: MucOccupant = {
      room: bareJid(from),
      nick: jidResource(from) ?? '',
      presence: type === 'unavailable' ? 'offline' : (firstTagText(stanza, 'show') ?? 'online'),
      affiliation: item?.getAttribute('affiliation') ?? 'none',
      role: item?.getAttribute('role') ?? 'none',
      self: codes.includes('110') || codes.includes('210'),
      codes
    }
    // the item jid attribute is present only in non-anonymous rooms
    const realJid = item?.getAttribute('jid')
    if (realJid) occupant.jid = realJid
    const nick = item?.getAttribute('nick')
    if (nick) occupant.newNick = nick
    // kick and ban reasons ride in an item reason child, falling back
    // to the status text some servers send instead
    const itemReason = item ? firstNsTag(item, NS.MUC_USER, 'reason')?.textContent : null
    const reason = itemReason ?? firstTagText(stanza, 'status')
    if (reason) occupant.reason = reason
    const occupantId = firstNsTag(stanza, NS.OCCUPANT_ID, 'occupant-id')?.getAttribute('id')
    if (occupantId) occupant.occupantId = occupantId
    if (caps) occupant.caps = caps
    occupant.avatarHash = avatarHash
    return { kind: 'occupant', occupant }
  }

  // stanza errors on the join path arrive without a muc#user payload:
  // surface the RFC 6120 code and condition so the room ui can react
  if (type === 'error') {
    const error = firstTag(stanza, 'error')
    const parsed: PresenceError = {
      from,
      code: error?.getAttribute('code') ?? undefined
    }
    if (error) {
      for (const child of childElements(error)) {
        if (child.localName === 'text') {
          parsed.text = child.textContent ?? undefined
        } else {
          parsed.condition ??= child.localName ?? undefined
        }
      }
    }
    return { kind: 'presenceError', error: parsed }
  }

  if (type === 'subscribe') {
    return {
      kind: 'subscribe',
      from: bareJid(from),
      status: firstTagText(stanza, 'status') ?? ''
    }
  }

  return {
    kind: 'presence',
    presence: {
      from: bareJid(from),
      show: type === 'unavailable' ? 'offline' : (firstTagText(stanza, 'show') ?? 'online'),
      status: firstTagText(stanza, 'status') ?? '',
      type: type ?? undefined,
      caps: caps ?? undefined,
      avatarHash
    }
  }
}

// XEP-0030 disco#info result. Reads identities, feature vars and any
// XEP-0128 extension forms; tolerates missing query or empty results.
