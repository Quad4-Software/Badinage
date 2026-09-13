// Outgoing <message> senders: chat bodies, reactions, attachments, chat
// states, receipts and markers. Each builds the stanza and pushes it
// through the transport.

import { $msg } from 'strophe.js'

import { NS } from '../ns'
import type { ChatState, MarkerType } from '../stanzas'
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
  // a correction is already acked by the round trip it replies to
  if (!opts?.replaceId) stanza.c('request', { xmlns: NS.RECEIPTS })
  conn.send(stanza)
  return id
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
