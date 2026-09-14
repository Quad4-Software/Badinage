// Jingle iq payloads: parse the wire form into JinglePacket and build
// outbound stanzas for every session action. The session layer owns
// ordering and state. This module is pure wire translation.

import { $iq } from 'strophe.js'

import type { StanzaBuilder } from '../features/transport'
import { childElements, firstNsTag } from '$lib/utils/xml'
import { NS } from '../ns'
import type {
  JingleAction,
  JingleCandidate,
  JingleContent,
  JinglePacket,
  JinglePayload,
  JingleTransport
} from './types'

// rtp-level session infos (ringing, active, hold) ride as a direct
// child of jingle in this namespace, not wrapped in an info element
const NS_JINGLE_RTP_INFO = 'urn:xmpp:jingle:apps:rtp:info:1'

function parseCandidate(el: Element): JingleCandidate | null {
  const foundation = el.getAttribute('foundation')
  const ip = el.getAttribute('ip')
  const port = el.getAttribute('port')
  if (!foundation || !ip || !port) return null
  const cand: JingleCandidate = {
    foundation,
    component: el.getAttribute('component') ?? '1',
    protocol: el.getAttribute('protocol') ?? 'udp',
    priority: el.getAttribute('priority') ?? '0',
    ip,
    port,
    type: el.getAttribute('type') ?? 'host',
    generation: el.getAttribute('generation') ?? '0',
    network: el.getAttribute('network') ?? '0'
  }
  const relAddr = el.getAttribute('rel-addr')
  const relPort = el.getAttribute('rel-port')
  if (relAddr) cand.relAddr = relAddr
  if (relPort) cand.relPort = relPort
  const id = el.getAttribute('id')
  if (id) cand.id = id
  return cand
}

function parsePayload(el: Element): JinglePayload | null {
  const id = el.getAttribute('id')
  const name = el.getAttribute('name')
  const clockrate = el.getAttribute('clockrate')
  if (!id || !name || !clockrate) return null
  const payload: JinglePayload = { id, name, clockrate }
  const channels = el.getAttribute('channels')
  if (channels) payload.channels = channels
  // XEP-0167: codec parameters are parameter children, serialized back
  // into one a=fmtp-style string for the sdp side
  const params = childElements(el)
    .filter((p) => p.localName === 'parameter')
    .map((p) => `${p.getAttribute('name') ?? ''}=${p.getAttribute('value') ?? ''}`)
    .join(';')
  if (params) payload.params = params
  return payload
}

function parseTransport(el: Element): JingleTransport {
  const transport: JingleTransport = { candidates: [] }
  const ufrag = el.getAttribute('ufrag')
  const pwd = el.getAttribute('pwd')
  if (ufrag) transport.ufrag = ufrag
  if (pwd) transport.pwd = pwd
  const fp = firstNsTag(el, NS.JINGLE_DTLS, 'fingerprint')
  if (fp) {
    transport.fingerprint = {
      hash: fp.getAttribute('hash') ?? 'sha-256',
      setup: fp.getAttribute('setup') ?? 'actpass',
      value: fp.textContent?.trim() ?? ''
    }
  }
  for (const child of childElements(el)) {
    if (child.localName === 'candidate') {
      const cand = parseCandidate(child)
      if (cand) transport.candidates.push(cand)
    }
  }
  return transport
}

function parseContent(el: Element): JingleContent | null {
  const name = el.getAttribute('name')
  if (!name) return null
  const desc = firstNsTag(el, NS.JINGLE_RTP, 'description')
  const transportEl = firstNsTag(el, NS.JINGLE_ICE, 'transport')
  const media = desc?.getAttribute('media') === 'video' ? 'video' : 'audio'
  const content: JingleContent = {
    name,
    media,
    creator: el.getAttribute('creator') === 'responder' ? 'responder' : 'initiator',
    senders: (el.getAttribute('senders') as JingleContent['senders']) ?? 'both',
    payloads: [],
    transport: transportEl ? parseTransport(transportEl) : { candidates: [] }
  }
  for (const child of childElements(desc ?? el)) {
    if (child.localName === 'payload-type') {
      const payload = parsePayload(child)
      if (payload) content.payloads.push(payload)
    }
  }
  return content
}

// the jingle element is the first jingle-ns child of the iq. Malformed
// packets return null so the caller can answer a stanza error
export function parseJingle(stanza: Element): JinglePacket | null {
  const jingle = firstNsTag(stanza, NS.JINGLE, 'jingle')
  if (!jingle) return null
  const action = jingle.getAttribute('action')
  const sid = jingle.getAttribute('sid')
  if (!action || !sid) return null
  const packet: JinglePacket = {
    action: action as JingleAction,
    sid,
    from: stanza.getAttribute('from') ?? '',
    contents: []
  }
  const initiator = jingle.getAttribute('initiator')
  const responder = jingle.getAttribute('responder')
  if (initiator) packet.initiator = initiator
  if (responder) packet.responder = responder
  for (const child of childElements(jingle)) {
    if (child.localName === 'content') {
      const content = parseContent(child)
      if (content) packet.contents.push(content)
    } else if (child.localName === 'reason') {
      const reason = childElements(child)[0]
      packet.reason = reason?.localName ?? 'success'
    } else if (child.namespaceURI === NS_JINGLE_RTP_INFO) {
      packet.info = child.localName
    }
  }
  return packet
}

function writeCandidate(parent: StanzaBuilder, c: JingleCandidate): void {
  const attrs: Record<string, string> = {
    foundation: c.foundation,
    component: c.component,
    protocol: c.protocol,
    priority: c.priority,
    ip: c.ip,
    port: c.port,
    type: c.type,
    generation: c.generation,
    network: c.network
  }
  if (c.relAddr) attrs['rel-addr'] = c.relAddr
  if (c.relPort) attrs['rel-port'] = c.relPort
  if (c.id) attrs.id = c.id
  parent.c('candidate', attrs).up()
}

function writePayload(parent: StanzaBuilder, p: JinglePayload): void {
  const attrs: Record<string, string> = {
    id: p.id,
    name: p.name,
    clockrate: p.clockrate
  }
  if (p.channels) attrs.channels = p.channels
  parent.c('payload-type', attrs)
  if (p.params) {
    for (const pair of p.params.split(';')) {
      const eq = pair.indexOf('=')
      if (eq > 0) {
        parent.c('parameter', { name: pair.slice(0, eq), value: pair.slice(eq + 1) }).up()
      }
    }
  }
  parent.up()
}

function writeContent(parent: StanzaBuilder, content: JingleContent): void {
  parent.c('content', {
    creator: content.creator,
    name: content.name,
    senders: content.senders
  })
  if (content.media !== undefined || content.payloads.length > 0) {
    parent.c('description', { xmlns: NS.JINGLE_RTP, media: content.media ?? 'audio' })
    for (const p of content.payloads) writePayload(parent, p)
    parent.up()
  }
  const t = content.transport
  if (t.ufrag || t.pwd || t.fingerprint || t.candidates.length > 0) {
    const attrs: Record<string, string> = { xmlns: NS.JINGLE_ICE }
    if (t.ufrag) attrs.ufrag = t.ufrag
    if (t.pwd) attrs.pwd = t.pwd
    parent.c('transport', attrs)
    if (t.fingerprint) {
      parent
        .c('fingerprint', {
          xmlns: NS.JINGLE_DTLS,
          hash: t.fingerprint.hash,
          setup: t.fingerprint.setup
        })
        .t(t.fingerprint.value)
        .up()
    }
    for (const c of t.candidates) writeCandidate(parent, c)
    parent.up()
  }
  parent.up()
}

// the stanza builders only need an id source - ChatConnection and
// XmppTransport both satisfy this, so state code can build directly
export interface UniqueIdSource {
  uniqueId(prefix: string): string
}

export function jingleIq(
  conn: UniqueIdSource,
  to: string,
  packet: Omit<JinglePacket, 'from'>
): StanzaBuilder {
  const attrs: Record<string, string> = {
    xmlns: NS.JINGLE,
    action: packet.action,
    sid: packet.sid
  }
  if (packet.initiator) attrs.initiator = packet.initiator
  if (packet.responder) attrs.responder = packet.responder
  const iq = $iq({ type: 'set', to, id: conn.uniqueId('jingle') }).c('jingle', attrs)
  for (const content of packet.contents) writeContent(iq, content)
  if (packet.reason) iq.c('reason').c(packet.reason).up().up()
  if (packet.info) iq.c(packet.info, { xmlns: NS_JINGLE_RTP_INFO }).up()
  return iq
}
