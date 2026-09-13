// Message payload sub-parsers: attachments, real-time text, references,
// geoloc, message display sync and channel-search items. Called from
// message.ts (and iq for the search items).

import type { RttEvent, RttOp, RttStanza } from '$lib/utils/protocol/rtt'
import { allNsTags, childElements, firstNsTag } from '$lib/utils/xml'

import { NS } from '../ns'
import type { Attachment, Geoloc, MessageReference } from './types'

export function parseAttachments(inner: Element): Attachment[] {
  const oob = firstNsTag(inner, NS.OOB, 'x')
  const oobUrl = oob ? (firstNsTag(oob, NS.OOB, 'url')?.textContent?.trim() ?? '') : ''
  const file = firstNsTag(inner, NS.FILE_METADATA, 'file')
  let url = oobUrl
  if (!url && file) {
    for (const ref of allNsTags(inner, NS.REFERENCE, 'reference')) {
      const uri = ref.getAttribute('uri')
      if (uri) {
        url = uri
        break
      }
    }
  }
  if (!url && !file) return []
  const attachment: Attachment = { url, mediaType: '' }
  if (file) {
    attachment.mediaType =
      firstNsTag(file, NS.FILE_METADATA, 'media-type')?.textContent?.trim() ?? ''
    const name = firstNsTag(file, NS.FILE_METADATA, 'name')?.textContent?.trim()
    if (name) attachment.name = name
    const size = Number.parseInt(
      firstNsTag(file, NS.FILE_METADATA, 'size')?.textContent?.trim() ?? '',
      10
    )
    if (Number.isFinite(size)) attachment.size = size
    const duration = Number.parseInt(
      firstNsTag(file, NS.FILE_METADATA, 'duration')?.textContent?.trim() ?? '',
      10
    )
    if (Number.isFinite(duration)) attachment.duration = duration
  }
  return [attachment]
}

// XEP-0191: collects the jid attributes of every <item> under a block,
// unblock or blocklist parent. An empty list on an unblock means the
// server cleared the whole blocklist.

// XEP-0301: the rtt element carries an event plus a run of action
// elements. Unknown events are ignored per spec. A missing event means
// 'edit'. Action elements keep their p/n positions in code points.
export function parseRtt(rtt: Element): RttStanza | null {
  const events: RttEvent[] = ['new', 'reset', 'edit', 'init', 'cancel']
  const raw = rtt.getAttribute('event') ?? 'edit'
  if (!events.includes(raw as RttEvent)) return null
  const seq = Number.parseInt(rtt.getAttribute('seq') ?? '', 10)
  const ops: RttOp[] = []
  for (const action of childElements(rtt)) {
    const p = Number.parseInt(action.getAttribute('p') ?? '', 10)
    const n = Number.parseInt(action.getAttribute('n') ?? '', 10)
    const pos = Number.isFinite(p) ? p : undefined
    const count = Number.isFinite(n) ? n : undefined
    switch (action.localName) {
      case 't':
        if (action.textContent) ops.push({ type: 't', p: pos, text: action.textContent })
        break
      case 'e':
        ops.push({ type: 'e', p: pos, n: count })
        break
      case 'd':
        ops.push({ type: 'd', p: pos, n: count })
        break
      case 'w':
        ops.push({ type: 'w', n: count })
        break
    }
  }
  return {
    event: raw as RttEvent,
    seq: Number.isFinite(seq) ? seq : undefined,
    ops
  }
}

// XEP-0372: every reference element, whatever its type. Consumers pick
// the types they understand (mention, data, begin...).
export function parseReferences(inner: Element): MessageReference[] {
  const out: MessageReference[] = []
  for (const ref of allNsTags(inner, NS.REFERENCE, 'reference')) {
    const type = ref.getAttribute('type')
    if (!type) continue
    const parsed: MessageReference = { type }
    const begin = Number.parseInt(ref.getAttribute('begin') ?? '', 10)
    const end = Number.parseInt(ref.getAttribute('end') ?? '', 10)
    if (Number.isFinite(begin)) parsed.begin = begin
    if (Number.isFinite(end)) parsed.end = end
    const uri = ref.getAttribute('uri')
    if (uri) parsed.uri = uri
    const anchor = ref.getAttribute('anchor')
    if (anchor) parsed.anchor = anchor
    out.push(parsed)
  }
  return out
}

// XEP-0080: lat/lon are required, accuracy optional. Out-of-range or
// non-numeric coordinates drop the whole element.
export function parseGeoloc(inner: Element): Geoloc | null {
  const el = firstNsTag(inner, NS.GEOLOC, 'geoloc')
  if (!el) return null
  const lat = Number.parseFloat(firstNsTag(el, NS.GEOLOC, 'lat')?.textContent ?? '')
  const lon = Number.parseFloat(firstNsTag(el, NS.GEOLOC, 'lon')?.textContent ?? '')
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const parsed: Geoloc = { lat, lon }
  const accuracy = Number.parseFloat(firstNsTag(el, NS.GEOLOC, 'accuracy')?.textContent ?? '')
  if (Number.isFinite(accuracy)) parsed.accuracy = accuracy
  return parsed
}

export interface MdsDisplayed {
  peer: string
  stanzaId: string
  by?: string | undefined
}

export function parseMdsItem(item: Element): MdsDisplayed | null {
  const peer = item.getAttribute('id')
  const displayed = firstNsTag(item, NS.MDS, 'displayed')
  const stanzaId = displayed ? firstNsTag(displayed, NS.STANZA_IDS, 'stanza-id') : null
  const id = stanzaId?.getAttribute('id')
  if (!peer || !id) return null
  return { peer, stanzaId: id, by: stanzaId?.getAttribute('by') ?? undefined }
}

// XEP-0433 channel search result items under the result wrapper.
export interface ChannelSearchItem {
  address: string
  name?: string | undefined
  description?: string | undefined
  language?: string | undefined
  nusers?: number | undefined
  serviceType?: string | undefined
  isOpen?: boolean | undefined
  anonymityMode?: string | undefined
}

export function parseChannelSearchItems(stanza: Element): ChannelSearchItem[] {
  const items: ChannelSearchItem[] = []
  for (const item of allNsTags(stanza, NS.CHANNEL_SEARCH, 'item')) {
    const address = item.getAttribute('address')
    if (!address) continue
    const entry: ChannelSearchItem = { address }
    const text = (local: string) =>
      firstNsTag(item, NS.CHANNEL_SEARCH, local)?.textContent?.trim() || undefined
    entry.name = text('name')
    entry.description = text('description')
    entry.language = text('language')
    entry.serviceType = text('service-type')
    entry.anonymityMode = text('anonymity-mode')
    const nusers = Number.parseInt(text('nusers') ?? '', 10)
    if (Number.isFinite(nusers)) entry.nusers = nusers
    entry.isOpen = firstNsTag(item, NS.CHANNEL_SEARCH, 'is-open') !== null
    items.push(entry)
  }
  return items
}

// The iq result closing a MAM query carries a <fin> with the rsm set
// for the page just returned.
