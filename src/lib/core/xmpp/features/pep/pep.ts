// PEP and OMEMO plumbing: pubsub item fetch/publish for device lists
// and bundles, plus the sender for pre-encrypted message payloads.

import { $iq, $msg } from 'strophe.js'

import { OMEMO_FALLBACK_BODY } from '$lib/constants'
import { firstNsTag } from '$lib/utils/xml'

import { NS } from '../../ns'
import type { XmppTransport } from '../transport'

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
    // c() descends into each named child. C() with text does not, so
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
// Replies, corrections, reactions and chat states all ride inside the SCE
// envelope: emitting them in the clear would leak message metadata, so
// this stanza only carries transport-level bits (origin-id, eme, store
// hint, receipt request).
export function sendEncryptedMessage(
  conn: XmppTransport,
  to: string,
  encryptedXml: string
): string {
  const id = conn.uniqueId('msg')
  const originId = conn.uniqueId('origin')
  const encrypted = domFromXml(encryptedXml)
  const stanza = $msg({ to, type: 'chat', id })
    .c('body')
    .t(OMEMO_FALLBACK_BODY)
    .up()
    .c('origin-id', { xmlns: NS.STANZA_IDS, id: originId })
    .up()
    .c('encryption', {
      xmlns: NS.EME,
      namespace: encrypted?.namespaceURI ?? NS.OMEMO,
      name: 'OMEMO'
    })
    .up()
    .c('store', { xmlns: NS.HINTS })
    .up()
    .c('request', { xmlns: NS.RECEIPTS })
  if (!encrypted) return id
  stanza.cnode(encrypted)
  conn.send(stanza)
  return id
}

// Minimal carrier for OMEMO payloads that are not user-visible messages:
// key transports (empty encrypted elements) and envelopes wrapping only
// reactions or chat states. No fallback body, no receipt request - the
// XEP-0384 guidance is that these should not look like missed content to
// clients that cannot decrypt.
export function sendEncryptedNotification(
  conn: XmppTransport,
  to: string,
  encryptedXml: string
): void {
  const encrypted = domFromXml(encryptedXml)
  if (!encrypted) return
  conn.send($msg({ to, type: 'chat', id: conn.uniqueId('omemo') }).cnode(encrypted))
}
