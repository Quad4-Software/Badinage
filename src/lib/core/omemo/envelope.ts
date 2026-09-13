// SCE envelope content helpers (XEP-0420 as used by XEP-0384 omemo:2).
// Outbound helpers build the extension elements that ride inside the
// encrypted envelope so replies, corrections, reactions, chat states and
// attachments never leak stanza metadata in the clear. Inbound,
// applyEnvelopeContent maps parsed envelope nodes back onto the same
// IncomingMessage fields that stanzas.ts fills for cleartext stanzas.
//
// These are pure functions over the omemo package's XmlElement model;
// namespace identity comes from the literal xmlns attribute.

import { NS } from '$lib/core/xmpp/ns'
import type { Attachment, ChatState, IncomingMessage } from '$lib/core/xmpp/stanzas'
import type { AttachmentMeta } from '$lib/core/xmpp/types'

import { childrenNamed, el, findChild } from '@quad4-software/omemo'
import type { XmlElement } from '@quad4-software/omemo'

const CHAT_STATE_NAMES = new Set<string>(['active', 'composing', 'paused', 'inactive', 'gone'])

// XEP-0461 reply reference. id is the referenced stanza id, to its author.
export function replyNode(ref: { id: string; to: string }): XmlElement {
  return el('reply', { xmlns: NS.REPLY, id: ref.id, to: ref.to })
}

// XEP-0308 correction reference.
export function replaceNode(id: string): XmlElement {
  return el('replace', { xmlns: NS.CORRECT, id })
}

// XEP-0444 reactions targeting a stanza id.
export function reactionsNode(targetId: string, emojis: string[]): XmlElement {
  return el(
    'reactions',
    { xmlns: NS.REACTIONS, id: targetId },
    emojis.map((emoji) => el('reaction', {}, [], emoji))
  )
}

// XEP-0085 chat state.
export function chatStateNode(state: ChatState): XmlElement {
  return el(state, { xmlns: NS.CHAT_STATES })
}

// XEP-0382 spoiler marker; the element text is the sender's hint, empty
// for a hintless spoiler.
export function spoilerNode(hint: string): XmlElement {
  return el('spoiler', { xmlns: NS.SPOILER }, [], hint)
}

// XEP-0466 ephemeral timer: the timer must ride inside the envelope so
// the cleartext stanza does not leak that the conversation is set to
// self-destruct.
export function ephemeralNode(timer: number): XmlElement {
  return el('ephemeral', { xmlns: NS.EPHEMERAL, timer: String(timer) })
}

// XEP-0080 location: coordinates go inside the envelope; the envelope
// body still carries the geo uri fallback.
export function geolocNode(geoloc: {
  lat: number
  lon: number
  accuracy?: number | undefined
}): XmlElement {
  const children = [el('lat', {}, [], String(geoloc.lat)), el('lon', {}, [], String(geoloc.lon))]
  if (geoloc.accuracy !== undefined) {
    children.push(el('accuracy', {}, [], String(geoloc.accuracy)))
  }
  return el('geoloc', { xmlns: NS.GEOLOC }, children)
}

// XEP-0066 out-of-band url plus optional XEP-0446 file metadata. The url
// also goes in the envelope body (handled by the caller) so clients that
// only read bodies still share something usable.
export function attachmentNodes(url: string, meta?: AttachmentMeta): XmlElement[] {
  const nodes: XmlElement[] = [el('x', { xmlns: NS.OOB }, [el('url', {}, [], url)])]
  if (meta) {
    const fileChildren: XmlElement[] = []
    if (meta.mediaType) fileChildren.push(el('media-type', {}, [], meta.mediaType))
    if (meta.name) fileChildren.push(el('name', {}, [], meta.name))
    if (meta.size !== undefined) fileChildren.push(el('size', {}, [], String(meta.size)))
    if (meta.duration !== undefined) {
      fileChildren.push(el('duration', {}, [], String(meta.duration)))
    }
    if (fileChildren.length > 0) {
      nodes.push(el('file', { xmlns: NS.FILE_METADATA }, fileChildren))
    }
  }
  return nodes
}

// Numeric leaf text inside file metadata; absent or non-numeric text is
// simply dropped rather than failing the whole envelope.
function childInt(node: XmlElement, name: string): number | undefined {
  const raw = findChild(node, name)?.text
  if (raw === undefined) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : undefined
}

// Map the content nodes of a decrypted SCE envelope onto the message. The
// wire-level parseMessage already ran on the cleartext stanza; envelope
// content wins because the cleartext nodes are fallback or absent.
export function applyEnvelopeContent(message: IncomingMessage, content: XmlElement[]): void {
  for (const node of content) {
    const xmlns = node.attrs['xmlns']
    if (node.name === 'reply' && xmlns === NS.REPLY) {
      message.replyTo = { id: node.attrs['id'] ?? '', from: node.attrs['to'] ?? '' }
    } else if (node.name === 'replace' && xmlns === NS.CORRECT) {
      const id = node.attrs['id']
      if (id) message.replaceId = id
    } else if (node.name === 'reactions' && xmlns === NS.REACTIONS) {
      message.reactionTo = {
        id: node.attrs['id'] ?? '',
        emojis: childrenNamed(node, 'reaction').map((r) => r.text)
      }
    } else if (CHAT_STATE_NAMES.has(node.name) && xmlns === NS.CHAT_STATES) {
      message.chatState = node.name as ChatState
    } else if (node.name === 'spoiler' && xmlns === NS.SPOILER) {
      message.spoilerHint = node.text
    } else if (node.name === 'ephemeral' && xmlns === NS.EPHEMERAL) {
      const timer = Number.parseInt(node.attrs['timer'] ?? '', 10)
      if (Number.isFinite(timer) && timer >= 0) message.ephemeralTimer = timer
    } else if (node.name === 'geoloc' && xmlns === NS.GEOLOC) {
      const lat = Number.parseFloat(findChild(node, 'lat')?.text ?? '')
      const lon = Number.parseFloat(findChild(node, 'lon')?.text ?? '')
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const accuracy = Number.parseFloat(findChild(node, 'accuracy')?.text ?? '')
        message.geoloc = {
          lat,
          lon,
          ...(Number.isFinite(accuracy) ? { accuracy } : {})
        }
      }
    }
  }

  const oob = content.find((node) => node.name === 'x' && node.attrs['xmlns'] === NS.OOB)
  const url = oob ? findChild(oob, 'url')?.text : undefined
  if (!url) return
  const attachment: Attachment = { url, mediaType: '' }
  const file = content.find(
    (node) => node.name === 'file' && node.attrs['xmlns'] === NS.FILE_METADATA
  )
  if (file) {
    attachment.mediaType = findChild(file, 'media-type')?.text ?? ''
    const name = findChild(file, 'name')?.text
    if (name) attachment.name = name
    const size = childInt(file, 'size')
    if (size !== undefined) attachment.size = size
    const duration = childInt(file, 'duration')
    if (duration !== undefined) attachment.duration = duration
  }
  message.attachments = [attachment]
}
