// PEP and OMEMO plumbing: pubsub item fetch/publish for device lists
// and bundles, plus the sender for pre-encrypted message payloads.

import { $iq, $msg } from 'strophe.js'

import { OMEMO_FALLBACK_BODY } from '$lib/constants'
import { firstNsTag } from '$lib/utils/xml'

import type { SendMessageOptions } from '../types'
import { NS } from '../ns'
import type { XmppTransport } from './transport'

function domFromXml(xml: string): Element | null {
  return new DOMParser().parseFromString(xml, 'text/xml').documentElement
}

// Resolves with the <items> element of the result iq, or null on error.
export function pepGet(
  conn: XmppTransport,
  node: string,
  jid: string | undefined,
  onDone: (items: Element | null) => void
): void {
  const attrs: Record<string, string> = { type: 'get', id: conn.uniqueId('pep') }
  if (jid) attrs.to = jid
  conn.sendIq(
    $iq(attrs).c('pubsub', { xmlns: NS.PUBSUB }).c('items', { node }),
    (stanza) => onDone(firstNsTag(stanza, NS.PUBSUB, 'items')),
    () => onDone(null)
  )
}

// XEP-0060 publish-options, sent alongside a publish so the server
// applies the node config atomically. Omitted options keep the server
// defaults.
export interface PepPublishOptions {
  persistItems?: boolean | undefined
  maxItems?: string | undefined
  accessModel?: string | undefined
  sendLastPublishedItem?: string | undefined
}

export function pepPublish(
  conn: XmppTransport,
  node: string,
  itemId: string,
  payloadXml: string,
  options?: PepPublishOptions,
  onDone?: (ok: boolean) => void
): void {
  const stanza = $iq({ type: 'set', id: conn.uniqueId('pep-pub') })
    .c('pubsub', { xmlns: NS.PUBSUB })
    .c('publish', { node })
    .c('item', { id: itemId })
  const payload = domFromXml(payloadXml)
  if (payload) stanza.cnode(payload).up()
  stanza.up().up() // item -> publish -> pubsub
  if (options) {
    // c() descends into each named child; c() with text does not, so
    // each field only needs one up() to get back to the form element
    stanza
      .c('publish-options')
      .c('x', { xmlns: NS.FORMS, type: 'submit' })
      .c('field', { var: 'FORM_TYPE', type: 'hidden' })
      .c('value', {}, NS.PUBSUB_PUBLISH_OPTIONS)
      .up()
    const fields: [string, string][] = []
    if (options.persistItems) fields.push(['pubsub#persist_items', 'true'])
    if (options.maxItems) fields.push(['pubsub#max_items', options.maxItems])
    if (options.sendLastPublishedItem) {
      fields.push(['pubsub#send_last_published_item', options.sendLastPublishedItem])
    }
    if (options.accessModel) fields.push(['pubsub#access_model', options.accessModel])
    for (const [varName, value] of fields) {
      stanza.c('field', { var: varName }).c('value', {}, value).up()
    }
  }
  conn.sendIq(
    stanza,
    () => onDone?.(true),
    () => onDone?.(false)
  )
}

// The cleartext body is fallback text for clients without OMEMO, so
// receiving clients that can decrypt replace it with the envelope body.
export function sendEncryptedMessage(
  conn: XmppTransport,
  to: string,
  encryptedXml: string,
  opts?: SendMessageOptions
): string {
  const id = conn.uniqueId('msg')
  const originId = conn.uniqueId('origin')
  const stanza = $msg({ to, type: 'chat', id })
    .c('body')
    .t(OMEMO_FALLBACK_BODY)
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
  // XEP-0382: the hint element travels in the clear like the fallback
  // body so supporting clients still hide the message behind a reveal
  if (opts?.spoilerHint !== undefined) {
    stanza.c('spoiler', { xmlns: NS.SPOILER })
    if (opts.spoilerHint) stanza.t(opts.spoilerHint)
    stanza.up()
  }
  stanza
    .c('encryption', { xmlns: NS.EME, namespace: NS.OMEMO, name: 'OMEMO' })
    .up()
    .c('store', { xmlns: NS.HINTS })
    .up()
    .c('request', { xmlns: NS.RECEIPTS })
  const encrypted = domFromXml(encryptedXml)
  if (!encrypted) return id
  stanza.cnode(encrypted)
  conn.send(stanza)
  return id
}
