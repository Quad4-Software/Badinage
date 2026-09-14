// Outgoing <message> senders: chat bodies, reactions, attachments, chat
// states, receipts, markers and retractions. Each builds the stanza and
// pushes it through the transport.

import { $msg } from 'strophe.js'

import type { RttEvent, RttOp } from '$lib/utils/protocol/rtt'

import { NS } from '../ns'
import type { ChatState, MarkerType, TrustOwner } from '../stanzas'
import type { AttachmentMeta, SendMessageOptions } from '../types'
import type { XmppTransport } from './transport'

export function sendChatMessage(
  conn: XmppTransport,
  to: string,
  body: string,
  type: 'chat' | 'groupchat' = 'chat',
  opts?: SendMessageOptions
): string {
  const id = conn.uniqueId('msg')
  const originId = conn.uniqueId('origin')
  const stanza = $msg({ to, type, id })
    .c('body')
    .t(body)
    .up()
    .c('origin-id', { xmlns: NS.STANZA_IDS, id: originId })
    .up()
  if (opts?.replyTo) {
    const author = 'to' in opts.replyTo ? opts.replyTo.to : opts.replyTo.from
    stanza.c('reply', { xmlns: NS.REPLY, id: opts.replyTo.id, to: author }).up()
  }
  if (opts?.replaceId) {
    stanza.c('replace', { xmlns: NS.CORRECT, id: opts.replaceId }).up()
  }
  // XEP-0382: an empty hint still emits the element so receivers hide
  // the body behind a reveal control
  if (opts?.spoilerHint !== undefined) {
    stanza.c('spoiler', { xmlns: NS.SPOILER })
    if (opts.spoilerHint) stanza.t(opts.spoilerHint)
    stanza.up()
  }
  // a correction is already acked by the round trip it replies to
  if (!opts?.replaceId) stanza.c('request', { xmlns: NS.RECEIPTS }).up()
  // XEP-0466: announce the conversation's ephemeral timer so both sides
  // agree on when messages self-destruct. Timer 0 turns the mode off and
  // must go out on the wire too
  if (opts?.ephemeral !== undefined) {
    stanza.c('ephemeral', { xmlns: NS.EPHEMERAL, timer: String(opts.ephemeral) }).up()
  }
  for (const ref of opts?.references ?? []) {
    const attrs: Record<string, string> = { xmlns: NS.REFERENCE, type: ref.type }
    if (ref.begin !== undefined) attrs.begin = String(ref.begin)
    if (ref.end !== undefined) attrs.end = String(ref.end)
    if (ref.uri) attrs.uri = ref.uri
    if (ref.anchor) attrs.anchor = ref.anchor
    stanza.c('reference', attrs).up()
  }
  // XEP-0080: coordinates plus a geo uri body fallback for clients that
  // only render bodies
  if (opts?.geoloc) {
    const geo = stanza.c('geoloc', { xmlns: NS.GEOLOC })
    geo.c('lat').t(String(opts.geoloc.lat)).up()
    geo.c('lon').t(String(opts.geoloc.lon)).up()
    if (opts.geoloc.accuracy !== undefined) {
      geo.c('accuracy').t(String(opts.geoloc.accuracy)).up()
    }
  }
  conn.send(stanza)
  return id
}

// XEP-0224: a bare attention signal. No body, no store hint - it is a
// live nudge, not archivable content.
export function sendAttention(
  conn: XmppTransport,
  to: string,
  type: 'chat' | 'groupchat' = 'chat'
): void {
  conn.send(
    $msg({ to, type, id: conn.uniqueId('attention') }).c('attention', { xmlns: NS.ATTENTION })
  )
}

// XEP-0301: one real-time text update for the message being composed.
// The stanza carries no body. Receivers rebuild the buffer from ops.
export function sendRtt(
  conn: XmppTransport,
  to: string,
  seq: number,
  event: RttEvent,
  ops: RttOp[]
): void {
  const stanza = $msg({ to, type: 'chat', id: conn.uniqueId('rtt') }).c('rtt', {
    xmlns: NS.RTT,
    seq: String(seq),
    event
  })
  for (const op of ops) {
    if (op.type === 't') {
      const attrs: Record<string, string> = {}
      if (op.p !== undefined) attrs.p = String(op.p)
      stanza.c('t', attrs).t(op.text).up()
    } else if (op.type === 'e' || op.type === 'd') {
      const attrs: Record<string, string> = {}
      if (op.p !== undefined) attrs.p = String(op.p)
      if (op.n !== undefined) attrs.n = String(op.n)
      stanza.c(op.type, attrs).up()
    } else if (op.type === 'w' && op.n !== undefined) {
      stanza.c('w', { n: String(op.n) }).up()
    }
  }
  conn.send(stanza)
}

// XEP-0444. An empty emojis list sends a bare reactions element, which
// retracts all reactions this sender previously set on the target.
export function sendReaction(
  conn: XmppTransport,
  to: string,
  targetId: string,
  emojis: string[],
  type: 'chat' | 'groupchat' = 'chat'
): void {
  const stanza = $msg({ to, type, id: conn.uniqueId('react') }).c('reactions', {
    xmlns: NS.REACTIONS,
    id: targetId
  })
  for (const emoji of emojis) stanza.c('reaction').t(emoji).up()
  conn.send(stanza)
}

// XEP-0066 plus optional XEP-0446 metadata. The url is duplicated into
// the body so plain clients still show something clickable.
export function sendAttachment(
  conn: XmppTransport,
  to: string,
  url: string,
  type: 'chat' | 'groupchat' = 'chat',
  meta?: AttachmentMeta
): string {
  const id = conn.uniqueId('msg')
  const originId = conn.uniqueId('origin')
  const stanza = $msg({ to, type, id })
    .c('body')
    .t(url)
    .up()
    .c('origin-id', { xmlns: NS.STANZA_IDS, id: originId })
    .up()
    .c('x', { xmlns: NS.OOB })
    .c('url')
    .t(url)
    .up()
    .up()
  if (meta) {
    const file = stanza.c('file', { xmlns: NS.FILE_METADATA })
    if (meta.mediaType) file.c('media-type').t(meta.mediaType).up()
    if (meta.name) file.c('name').t(meta.name).up()
    if (meta.size !== undefined) file.c('size').t(String(meta.size)).up()
    if (meta.duration !== undefined) file.c('duration').t(String(meta.duration)).up()
    file.up()
  }
  stanza.c('request', { xmlns: NS.RECEIPTS })
  conn.send(stanza)
  return id
}

export function sendChatState(
  conn: XmppTransport,
  to: string,
  state: ChatState,
  type: 'chat' | 'groupchat' = 'chat'
): void {
  conn.send($msg({ to, type }).c(state, { xmlns: NS.CHAT_STATES }))
}

export function sendReceipt(conn: XmppTransport, to: string, id: string): void {
  conn.send($msg({ to, type: 'chat' }).c('received', { xmlns: NS.RECEIPTS, id }))
}

export function sendMarker(conn: XmppTransport, to: string, id: string, marker: MarkerType): void {
  conn.send($msg({ to, type: 'chat' }).c(marker, { xmlns: NS.MARKERS, id }))
}

// XEP-0424: ask receivers to retract the message with the given id. The
// fallback body and store hint keep the stanza archived and readable on
// clients without retraction support.
export function sendRetraction(
  conn: XmppTransport,
  to: string,
  targetId: string,
  type: 'chat' | 'groupchat' = 'chat'
): void {
  const stanza = $msg({ to, type, id: conn.uniqueId('retract') })
    .c('retract', { xmlns: NS.MESSAGE_RETRACT, id: targetId })
    .up()
    .c('fallback', { xmlns: NS.FALLBACK, for: NS.MESSAGE_RETRACT })
    .up()
    .c('body')
    .t('/me retracted a message')
    .up()
    .c('store', { xmlns: NS.HINTS })
  conn.send(stanza)
}

// XEP-0434: sync a trust decision to our other devices. Sent to our own
// bare jid with a store hint so every online resource and MAM see it.
// usage names the encryption protocol the fingerprints belong to
export function sendTrustMessage(
  conn: XmppTransport,
  to: string,
  usage: string,
  owners: TrustOwner[]
): void {
  const stanza = $msg({ to, type: 'chat', id: conn.uniqueId('tm') })
    .c('store', { xmlns: NS.HINTS })
    .up()
    .c('trust-message', { xmlns: NS.TM, usage })
  for (const owner of owners) {
    stanza.c('key-owner', { jid: owner.jid })
    for (const fp of owner.trust) stanza.c('trust').t(fp).up()
    for (const fp of owner.distrust) stanza.c('distrust').t(fp).up()
    stanza.up()
  }
  conn.send(stanza)
}
