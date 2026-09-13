// Chat <message> parsing: the IncomingMessage shape plus the parser and
// its message-specific helpers.

import { bareJid, jidResource } from '$lib/utils/jid'
import { allNsTags, firstNsTag, firstTag, firstTagText, serializeElement } from '$lib/utils/xml'

import { NS } from '../ns'
import { parseAttachments, parseGeoloc, parseReferences, parseRtt } from './payloads'
import type { ChatState, IncomingMessage } from './types'

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

  const stanzaIdEl = firstNsTag(inner, NS.STANZA_IDS, 'stanza-id')
  const stanzaId = stanzaIdEl?.getAttribute('id')
  if (stanzaId) message.stanzaId = stanzaId
  const stanzaBy = stanzaIdEl?.getAttribute('by')
  if (stanzaBy) message.stanzaBy = stanzaBy
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

  // XEP-0424 retraction: a direct <retract id> child is the current
  // form; older drafts wrapped message-retract:0 inside a fasten
  // apply-to whose own id names the target. A missing id still marks
  // the stanza as a retraction so its fallback body never renders.
  // XEP-0425 room moderation rides the same element but nests a
  // <moderated> child, which is what separates a room-issued removal
  // (retraction, no author check) from an author's own retract
  // (retractId, same-sender checked).
  const retract = firstNsTag(inner, NS.MESSAGE_RETRACT, 'retract')
  if (retract) {
    const moderated = firstNsTag(retract, NS.MESSAGE_MODERATE, 'moderated')
    if (moderated) {
      message.retraction = {
        id: retract.getAttribute('id') ?? '',
        reason: firstTagText(retract, 'reason') ?? undefined,
        by: moderatedBy(moderated)
      }
    } else {
      message.retractId = retract.getAttribute('id') ?? ''
    }
  } else {
    for (const applyTo of allNsTags(inner, NS.FASTEN, 'apply-to')) {
      const legacy =
        firstNsTag(applyTo, NS.MESSAGE_RETRACT, 'retract') ??
        firstNsTag(applyTo, NS.MESSAGE_RETRACT_LEGACY, 'retract')
      if (legacy) {
        message.retractId = legacy.getAttribute('id') ?? applyTo.getAttribute('id') ?? ''
        break
      }
    }
  }
  // XEP-0424/0425 tombstone in archive results: the retracted element in
  // past tense means this stanza itself is already retracted content;
  // reason and by come from the room's moderated marker when present
  const retractedEl =
    firstNsTag(inner, NS.MESSAGE_RETRACT, 'retracted') ??
    firstNsTag(inner, NS.MESSAGE_RETRACT_LEGACY, 'retracted')
  if (retractedEl) {
    const moderated = firstNsTag(retractedEl, NS.MESSAGE_MODERATE, 'moderated')
    message.retracted = {
      reason: firstTagText(retractedEl, 'reason') ?? undefined,
      by: moderatedBy(moderated)
    }
  }

  const spoiler = firstNsTag(inner, NS.SPOILER, 'spoiler')
  if (spoiler) message.spoilerHint = spoiler.textContent ?? ''
  if (firstNsTag(inner, NS.STYLING, 'unstyled')) message.unstyled = true

  const attachments = parseAttachments(inner)
  if (attachments.length > 0) message.attachments = attachments

  if (firstNsTag(inner, NS.ATTENTION, 'attention')) message.attention = true

  const rtt = firstNsTag(inner, NS.RTT, 'rtt')
  if (rtt) {
    const parsed = parseRtt(rtt)
    if (parsed) message.rtt = parsed
  }

  const references = parseReferences(inner)
  if (references.length > 0) message.references = references

  const ephemeral = firstNsTag(inner, NS.EPHEMERAL, 'ephemeral')
  if (ephemeral) {
    const timer = Number.parseInt(ephemeral.getAttribute('timer') ?? '', 10)
    if (Number.isFinite(timer) && timer >= 0) message.ephemeralTimer = timer
  }

  const geoloc = parseGeoloc(inner)
  if (geoloc) message.geoloc = geoloc

  const occupantId = firstNsTag(inner, NS.OCCUPANT_ID, 'occupant-id')?.getAttribute('id')
  if (occupantId) message.occupantId = occupantId

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
    message.retractId === undefined &&
    !message.retracted &&
    !message.attachments?.length &&
    !message.encryptedXml &&
    !message.retraction &&
    !message.retracted &&
    !message.attention &&
    !message.rtt &&
    message.ephemeralTimer === undefined &&
    !message.geoloc &&
    message.subject === undefined
  ) {
    return null
  }
  return message
}

// The moderated element inside a retract or retracted names the
// moderating entity by jid, or by occupant id in semi-anonymous rooms.
function moderatedBy(moderated: Element | null): string | undefined {
  if (!moderated) return undefined
  return (
    moderated.getAttribute('by') ??
    firstNsTag(moderated, NS.OCCUPANT_ID, 'occupant-id')?.getAttribute('id') ??
    undefined
  )
}
