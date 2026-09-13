// Stanza parsing: pure Element -> typed event helpers. Everything here is a
// pure function over DOM Elements so it can be unit tested without Strophe.
// Uses getElementsByTagName(NS) rather than querySelector because the test
// suite runs under @xmldom/xmldom, which has no selector engine.

import { bareJid, jidResource } from '$lib/utils/jid'
import { allNsTags, firstNsTag, firstTag, firstTagText, serializeElement } from '$lib/utils/xml'

import { NS } from './ns'

export interface RosterItem {
  jid: string
  name: string
  subscription: string
  ask?: string | undefined
  groups: string[]
}

export type ChatState = 'active' | 'composing' | 'paused' | 'inactive' | 'gone'
export type MarkerType = 'received' | 'displayed' | 'acknowledged'

export interface Attachment {
  url: string
  mediaType: string
  name?: string | undefined
  size?: number | undefined
  duration?: number | undefined
}

export interface IncomingMessage {
  from: string
  to: string
  body: string
  type: 'chat' | 'groupchat'
  // the stanza's own id attribute - receipts and chat markers reference this
  id?: string | undefined
  stanzaId?: string | undefined
  originId?: string | undefined
  delay?: number | undefined
  // carbons: another device of ours sent ('sent') or received ('received')
  // this. mam: the stanza came out of an archive query. Neither means live.
  carbon?: 'sent' | 'received' | undefined
  mam?: boolean | undefined
  chatState?: ChatState | undefined
  receiptRequest?: boolean | undefined
  receiptFor?: string | undefined
  marker?: { id: string; type: MarkerType } | undefined
  nick?: string | undefined
  subject?: string | undefined
  // XEP-0461: this message replies to the stanza with this id, sent by the
  // jid in from. quote is the text recovered from the body fallback.
  replyTo?: { id: string; from: string; quote?: string | undefined } | undefined
  // XEP-0444: reactions targeting the stanza with this id. An empty emojis
  // list retracts all previous reactions from this sender.
  reactionTo?: { id: string; emojis: string[] } | undefined
  // XEP-0308: this body replaces the stanza with this id.
  replaceId?: string | undefined
  attachments?: Attachment[] | undefined
  // signature state for the UI: set by transports that can prove it
  // (OMEMO once verification lands, OpenPGP later). Not parsed here.
  signed?: boolean | undefined
  encrypted?: boolean | undefined
  // serialized <encrypted> element, handed to the OMEMO service for
  // async decryption before ingest
  encryptedXml?: string | undefined
  // decryption was attempted and failed; the body must not be trusted
  undecryptable?: boolean | undefined
  // decrypted, but the sending device is distrusted or changed keys
  untrustedDevice?: boolean | undefined
}

export interface PresenceUpdate {
  from: string
  show: string
  status: string
  type?: string | undefined
}

export interface MucOccupant {
  room: string
  nick: string
  presence: string
  affiliation: string
  role: string
  self: boolean
  codes: string[]
}

// XEP-0363 slot granted by an upload service: PUT the file to putUrl,
// share getUrl.
export interface UploadSlot {
  putUrl: string
  getUrl: string
}

// One page of a MAM query result. rsm uid of the oldest row in this
// page is first - pass it as before to fetch the next older page.
export interface MamPageResult {
  complete: boolean
  last?: string | undefined
  first?: string | undefined
}

const CHAT_STATES: ChatState[] = ['active', 'composing', 'paused', 'inactive', 'gone']

// XEP-0461 senders add a XEP-0393 style quote fallback at the top of the
// body: one leading line per quoted line, each prefixed with '> '. Strip
// those lines from the body and return the quoted text on its own.
function stripReplyFallback(body: string): { rest: string; quote?: string | undefined } {
  const lines = body.split('\n')
  const quoteLines: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line === '>' || line.startsWith('> ')) {
      quoteLines.push(line.slice(1).replace(/^ /, ''))
      i++
    } else {
      break
    }
  }
  if (i === 0) return { rest: body }
  return { rest: lines.slice(i).join('\n'), quote: quoteLines.join('\n') }
}

// XEP-0066 out-of-band data, optionally enriched by XEP-0446 file metadata.
// The metadata element also matches when it sits inside a XEP-0447 SIMS
// media-sharing wrapper, in which case the url comes from a data reference
// in the sources element. Returns at most one attachment.
function parseAttachments(inner: Element): Attachment[] {
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
export function parseJidItems(el: Element): string[] {
  const jids: string[] = []
  for (const item of allNsTags(el, NS.BLOCKING, 'item')) {
    const jid = item.getAttribute('jid')
    if (jid) jids.push(jid)
  }
  return jids
}

// XEP-0191 push: the server tells every resource which jids entered or
// left the blocklist. A field stays undefined when the push carried no
// matching element; an item-less unblock means the list was cleared.
export function parseBlockPush(stanza: Element): {
  blocked?: string[] | undefined
  unblocked?: string[] | undefined
} {
  const block = firstNsTag(stanza, NS.BLOCKING, 'block')
  const unblock = firstNsTag(stanza, NS.BLOCKING, 'unblock')
  return {
    blocked: block ? parseJidItems(block) : undefined,
    unblocked: unblock ? parseJidItems(unblock) : undefined
  }
}

export function parseRosterItems(stanza: Element): RosterItem[] {
  const items: RosterItem[] = []
  for (const el of allNsTags(stanza, NS.ROSTER, 'item')) {
    items.push({
      jid: el.getAttribute('jid') ?? '',
      name: el.getAttribute('name') ?? '',
      subscription: el.getAttribute('subscription') ?? 'none',
      ask: el.getAttribute('ask') ?? undefined,
      groups: allNsTags(el, NS.ROSTER, 'group').map((g) => g.textContent ?? '')
    })
  }
  return items
}

// Unwrap a carbon or MAM result to the real stanza inside <forwarded>.
// Returns null when the stanza is not wrapped.
function unwrapForwarded(stanza: Element): {
  inner: Element
  kind: 'carbon-sent' | 'carbon-received' | 'mam'
  delay?: string | undefined
} | null {
  const ownBare = bareJid(stanza.getAttribute('to') ?? '')
  const fromBare = bareJid(stanza.getAttribute('from') ?? '')

  for (const dir of ['sent', 'received'] as const) {
    const wrapper = firstNsTag(stanza, NS.CARBONS, dir)
    const forwarded = wrapper ? firstNsTag(wrapper, NS.FORWARD, 'forwarded') : null
    const inner = forwarded ? firstTag(forwarded, 'message') : null
    if (inner && forwarded && ownBare === fromBare) {
      const delay = firstNsTag(forwarded, NS.DELAY, 'delay')?.getAttribute('stamp')
      return { inner, kind: `carbon-${dir}`, delay: delay ?? undefined }
    }
  }

  const result = firstNsTag(stanza, NS.MAM, 'result')
  const forwarded = result ? firstNsTag(result, NS.FORWARD, 'forwarded') : null
  const inner = forwarded ? firstTag(forwarded, 'message') : null
  if (inner && forwarded) {
    const delay = firstNsTag(forwarded, NS.DELAY, 'delay')?.getAttribute('stamp')
    return { inner, kind: 'mam', delay: delay ?? undefined }
  }

  return null
}

// Parse a <message> (already unwrapped if it was a carbon or MAM result) into
// our IncomingMessage shape. Returns null when the stanza carries nothing
// actionable.
export function parseMessage(stanza: Element): IncomingMessage | null {
  const forwarded = unwrapForwarded(stanza)
  const inner = forwarded?.inner ?? stanza
  const type = inner.getAttribute('type') === 'groupchat' ? 'groupchat' : 'chat'

  const message: IncomingMessage = {
    from: inner.getAttribute('from') ?? '',
    to: inner.getAttribute('to') ?? '',
    body: '',
    type,
    id: inner.getAttribute('id') ?? undefined
  }
  if (forwarded?.kind === 'carbon-sent') message.carbon = 'sent'
  if (forwarded?.kind === 'carbon-received') message.carbon = 'received'
  if (forwarded?.kind === 'mam') message.mam = true

  const stanzaId = firstNsTag(inner, NS.STANZA_IDS, 'stanza-id')?.getAttribute('id')
  if (stanzaId) message.stanzaId = stanzaId
  const originId = firstNsTag(inner, NS.STANZA_IDS, 'origin-id')?.getAttribute('id')
  if (originId) message.originId = originId
  const delay =
    forwarded?.delay ?? firstNsTag(inner, NS.DELAY, 'delay')?.getAttribute('stamp') ?? undefined
  if (delay) message.delay = Date.parse(delay)

  for (const state of CHAT_STATES) {
    if (firstNsTag(inner, NS.CHAT_STATES, state)) {
      message.chatState = state
      break
    }
  }
  const receipt = firstNsTag(inner, NS.RECEIPTS, 'received')
  if (receipt) message.receiptFor = receipt.getAttribute('id') ?? undefined
  for (const marker of ['received', 'displayed', 'acknowledged'] as const) {
    const el = firstNsTag(inner, NS.MARKERS, marker)
    if (el) {
      message.marker = { id: el.getAttribute('id') ?? '', type: marker }
      break
    }
  }
  if (firstNsTag(inner, NS.RECEIPTS, 'request')) {
    message.receiptRequest = true
  }

  const reply = firstNsTag(inner, NS.REPLY, 'reply')
  if (reply) {
    message.replyTo = {
      id: reply.getAttribute('id') ?? '',
      from: reply.getAttribute('to') ?? ''
    }
  }
  const reactions = firstNsTag(inner, NS.REACTIONS, 'reactions')
  if (reactions) {
    message.reactionTo = {
      id: reactions.getAttribute('id') ?? '',
      emojis: allNsTags(reactions, NS.REACTIONS, 'reaction').map((r) => r.textContent ?? '')
    }
  }
  const replace = firstNsTag(inner, NS.CORRECT, 'replace')
  if (replace) message.replaceId = replace.getAttribute('id') ?? undefined
  const attachments = parseAttachments(inner)
  if (attachments.length > 0) message.attachments = attachments

  // OMEMO payloads survive as raw xml for the service layer to decrypt;
  // the wire body is only a fallback for clients without encryption.
  const encrypted =
    firstNsTag(inner, NS.OMEMO, 'encrypted') ?? firstNsTag(inner, NS.OMEMO_LEGACY, 'encrypted')
  if (encrypted) message.encryptedXml = serializeElement(encrypted)

  if (type === 'groupchat') {
    message.nick = jidResource(message.from) ?? undefined
    const subject = firstTagText(inner, 'subject')
    if (subject !== null) message.subject = subject
  }

  const body = firstTagText(inner, 'body')
  if (body) message.body = body
  if (message.replyTo && message.body) {
    const stripped = stripReplyFallback(message.body)
    if (stripped.quote !== undefined) message.replyTo.quote = stripped.quote
    message.body = stripped.rest
  }
  // file transfers often carry no body at all; the oob url doubles as one
  if (!message.body && message.attachments?.[0]?.url) {
    message.body = message.attachments[0].url
  }

  if (
    !message.body &&
    !message.chatState &&
    !message.receiptFor &&
    !message.marker &&
    !message.reactionTo &&
    !message.attachments?.length &&
    !message.encryptedXml &&
    message.subject === undefined
  ) {
    return null
  }
  return message
}

// Parse a <presence> stanza. Returns one of three shapes: an occupant update
// for MUC, a subscription request, or a plain presence update.
export function parsePresence(
  stanza: Element
):
  | { kind: 'occupant'; occupant: MucOccupant }
  | { kind: 'subscribe'; from: string; status: string }
  | { kind: 'presence'; presence: PresenceUpdate }
  | null {
  const from = stanza.getAttribute('from')
  if (!from) return null
  const type = stanza.getAttribute('type')

  const mucUser = firstNsTag(stanza, NS.MUC_USER, 'x')
  if (mucUser) {
    const item = firstNsTag(mucUser, NS.MUC_USER, 'item')
    const codes = allNsTags(mucUser, NS.MUC_USER, 'status').map((s) => s.getAttribute('code') ?? '')
    return {
      kind: 'occupant',
      occupant: {
        room: bareJid(from),
        nick: jidResource(from) ?? '',
        presence: type === 'unavailable' ? 'offline' : (firstTagText(stanza, 'show') ?? 'online'),
        affiliation: item?.getAttribute('affiliation') ?? 'none',
        role: item?.getAttribute('role') ?? 'none',
        self: codes.includes('110') || codes.includes('210'),
        codes
      }
    }
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
      type: type ?? undefined
    }
  }
}

// disco#items result: the jids of the server's components, used to
// hunt for an upload service.
export function parseDiscoItemJids(stanza: Element): string[] {
  const jids: string[] = []
  for (const item of allNsTags(stanza, NS.DISCO_ITEMS, 'item')) {
    const jid = item.getAttribute('jid')
    if (jid) jids.push(jid)
  }
  return jids
}

// Does a disco#info result advertise the given feature var.
export function hasDiscoFeature(stanza: Element, featureVar: string): boolean {
  for (const feature of allNsTags(stanza, NS.DISCO_INFO, 'feature')) {
    if (feature.getAttribute('var') === featureVar) return true
  }
  return false
}

// XEP-0363 slot response. The url is an attribute in
// urn:xmpp:http:upload:0 and text content in the newer namespace, so
// accept both.
export function parseUploadSlot(stanza: Element): UploadSlot | null {
  const slot = firstNsTag(stanza, NS.HTTP_UPLOAD, 'slot')
  const put = slot ? firstTag(slot, 'put') : null
  const get = slot ? firstTag(slot, 'get') : null
  const putUrl = put?.getAttribute('url') ?? put?.textContent?.trim() ?? null
  const getUrl = get?.getAttribute('url') ?? get?.textContent?.trim() ?? null
  return putUrl && getUrl ? { putUrl, getUrl } : null
}

// vcard-temp PHOTO as a data uri, or undefined when the stanza carries
// no usable photo.
export function parseVcardPhoto(stanza: Element): string | undefined {
  const vcard = firstTag(stanza, 'vCard')
  const photo = vcard ? firstTag(vcard, 'PHOTO') : null
  const type = photo ? firstTagText(photo, 'TYPE') : null
  const binval = photo ? firstTagText(photo, 'BINVAL') : null
  return type && binval ? `data:${type};base64,${binval.trim()}` : undefined
}

// The iq result closing a MAM query carries a <fin> with the rsm set
// for the page just returned.
export function parseMamFin(stanza: Element): MamPageResult {
  const fin = firstNsTag(stanza, NS.MAM, 'fin')
  const set = fin ? firstNsTag(fin, NS.RSM, 'set') : null
  const last = set ? firstTagText(set, 'last') : null
  const first = set ? firstTagText(set, 'first') : null
  return {
    complete: fin?.getAttribute('complete') === 'true',
    last: last ?? undefined,
    first: first ?? undefined
  }
}
