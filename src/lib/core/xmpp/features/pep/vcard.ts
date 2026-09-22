// Own vcard-temp profile (XEP-0054): fetch and publish for the account's
// own card. Publishing also stamps the XEP-0153 photo hash onto the
// transport so every later presence broadcast advertises the new avatar.
// The set path merges over the fetched card so fields we do not model
// (BDAY, ADR and friends) survive an edit.

import { $iq } from 'strophe.js'

import { base64ToBytes, sha1Hex } from '$lib/utils/protocol/sha1'
import { firstNsTag } from '$lib/utils/xml'

import { NS } from '../../ns'
import { parseVcard, type Vcard } from '../../stanzas'
import type { VcardApi } from '../../types'
import type { XmppTransport } from '../transport'

// children of vCard that a publish replaces. Everything else is kept
const VCARD_MANAGED = ['FN', 'NICKNAME', 'DESC', 'PHOTO']

// a data:image/... uri back into the TYPE/BINVAL pair the stanza needs.
// non-image payloads never reach the wire
function photoParts(photoUri: string): { type: string; binval: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(photoUri)
  if (!match?.[1] || !match[2]) return null
  return { type: match[1].toLowerCase(), binval: match[2].replace(/\s+/g, '') }
}

function mergeVcard(existing: Element | null, doc: Document, vcard: Vcard): Element {
  const card = existing
    ? (existing.cloneNode(true) as Element)
    : doc.createElementNS(NS.VCARD_TEMP, 'vCard')
  // strophe serializes attributes, not namespaceURI: the wire xml only
  // carries vcard-temp when xmlns is a real attribute, which also puts
  // the unprefixed managed children in the right namespace
  card.setAttribute('xmlns', NS.VCARD_TEMP)
  for (const el of [...card.children]) {
    if (VCARD_MANAGED.includes(el.localName)) el.remove()
  }
  const append = (parent: Element, name: string, text: string): Element => {
    const el = doc.createElementNS(NS.VCARD_TEMP, name)
    el.textContent = text
    parent.appendChild(el)
    return el
  }
  append(card, 'FN', vcard.fn)
  append(card, 'NICKNAME', vcard.nickname)
  append(card, 'DESC', vcard.desc)
  const photo = vcard.photoUri ? photoParts(vcard.photoUri) : null
  if (photo) {
    const el = append(card, 'PHOTO', '')
    append(el, 'TYPE', photo.type)
    append(el, 'BINVAL', photo.binval)
  }
  return card
}

export function createVcardApi(getConn: () => XmppTransport): VcardApi {
  // to undefined reads our own card, a jid reads the peer's
  const get = (to: string | undefined, onDone: (stanza: Element | null) => void): void => {
    const conn = getConn()
    const attrs: Record<string, string> = { type: 'get', id: conn.uniqueId('vcard') }
    if (to !== undefined) attrs.to = to
    conn.sendIq(
      $iq(attrs).c('vCard', { xmlns: NS.VCARD_TEMP }),
      (stanza) => onDone(stanza),
      () => onDone(null)
    )
  }
  return {
    fetch(onDone) {
      get(undefined, (stanza) => onDone(stanza ? parseVcard(stanza) : null))
    },
    fetchPeer(jid, onDone) {
      get(jid, (stanza) => onDone(stanza ? parseVcard(stanza) : null))
    },
    set(vcard, onDone) {
      const conn = getConn()
      // fetch the stored card first so unmanaged fields survive the set
      get(undefined, (stanza) => {
        const doc = stanza?.ownerDocument ?? document.implementation.createDocument('', 'empty')
        const card = mergeVcard(
          stanza ? firstNsTag(stanza, NS.VCARD_TEMP, 'vCard') : null,
          doc,
          vcard
        )
        conn.sendIq(
          $iq({ type: 'set', id: conn.uniqueId('vcard') }).cnode(card),
          () => {
            const photo = vcard.photoUri ? photoParts(vcard.photoUri) : null
            const bytes = photo ? base64ToBytes(photo.binval) : null
            // XEP-0153: the empty hash advertises that the avatar is gone
            conn.avatarHash = photo && bytes ? sha1Hex(bytes) : ''
            onDone(true)
          },
          () => onDone(false)
        )
      })
    }
  }
}
