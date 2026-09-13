// XEP-0030 service discovery and XEP-0115 entity capabilities.
//
// DISCO_FEATURES is the single registry of everything this client
// advertises: it feeds both the disco#info answers we send and the caps
// verification string in outgoing presence. Streams adding wire support
// (OMEMO, push notifications) must append their namespaces here so the
// published hash tracks the real feature set. Changing this list changes
// the advertised ver, which is exactly what caps is for.

import { $iq } from 'strophe.js'

import { CAPS_NODE, DISCO_NEGATIVE_TTL_MS, DISCO_TIMEOUT_MS } from '$lib/constants'
import { idb } from '$lib/core/storage/idb'
import { globalKey } from '$lib/core/storage/keys'
import { sha1Base64Utf8 } from '$lib/utils/sha1'
import { firstNsTag } from '$lib/utils/xml'

import { NS } from '../ns'
import {
  parseDiscoInfo,
  parseDiscoItems,
  type CapsRef,
  type DiscoForm,
  type DiscoIdentity,
  type DiscoInfo,
  type DiscoItem
} from '../stanzas'
import type { XmppTransport } from './transport'

export const DISCO_IDENTITY: DiscoIdentity = {
  category: 'client',
  type: 'web',
  name: 'Badinage'
}

export const DISCO_FEATURES: readonly string[] = [
  NS.DISCO_INFO,
  NS.DISCO_ITEMS,
  NS.CAPS,
  NS.MUC,
  NS.MAM,
  NS.CARBONS,
  NS.CHAT_STATES,
  NS.RECEIPTS,
  NS.MARKERS,
  NS.REPLY,
  NS.REACTIONS,
  NS.CORRECT,
  NS.STANZA_IDS,
  NS.BLOCKING,
  NS.VCARD_TEMP,
  NS.VCARD_UPDATE,
  NS.HTTP_UPLOAD,
  NS.EME,
  NS.BOOKMARKS,
  // PEP auto-subscription: advertising +notify makes the server send us
  // bookmark changes made by our other clients
  `${NS.BOOKMARKS}+notify`
]

// i;octet collation (RFC 4790 9.3): code point order, which utf-16
// string comparison matches for everything involved here
function byOctet(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// XEP-0115 verification string: sorted identity category/type/lang/name,
// sorted feature vars, then sorted extension forms (form type, then each
// field var with sorted values), everything delimited by '<' and hashed
// with sha1 in base64.
export function capsVerificationString(
  identities: DiscoIdentity[],
  features: readonly string[],
  forms: DiscoForm[] = []
): string {
  let s = ''
  const ids = identities
    .map((i) => `${i.category}/${i.type}/${i.lang ?? ''}/${i.name ?? ''}`)
    .sort(byOctet)
  for (const id of ids) s += `${id}<`
  for (const feature of [...features].sort(byOctet)) s += `${feature}<`
  for (const form of [...forms].sort((a, b) => byOctet(a.formType, b.formType))) {
    s += `${form.formType}<`
    for (const field of [...form.fields].sort((a, b) => byOctet(a.var, b.var))) {
      s += `${field.var}<`
      for (const value of [...field.values].sort(byOctet)) s += `${value}<`
    }
  }
  return sha1Base64Utf8(s)
}

let ownVer: string | undefined

// Our own caps descriptor for outgoing presence. The ver is computed
// once because the advertised set is static for the session.
export function ownCaps(): CapsRef {
  ownVer ??= capsVerificationString([DISCO_IDENTITY], DISCO_FEATURES)
  return { node: CAPS_NODE, hash: 'sha-1', ver: ownVer }
}

// ---- query cache --------------------------------------------------------

// results live for the session; negative results are retried after
// DISCO_NEGATIVE_TTL_MS so a temporarily unreachable jid does not stay
// blacklisted forever
interface CacheEntry<T> {
  value: T | null
  at: number
  // set while a query is in flight; extra callers queue here
  waiters?: ((value: T | null) => void)[] | undefined
}

// one cache per connection: keyed WeakMap so dropped connections take
// their cache with them and multi-account state never mixes
const infoCaches = new WeakMap<XmppTransport, Map<string, CacheEntry<DiscoInfo>>>()
const itemCaches = new WeakMap<XmppTransport, Map<string, CacheEntry<DiscoItem[]>>>()

function cacheFor<T>(
  caches: WeakMap<XmppTransport, Map<string, CacheEntry<T>>>,
  conn: XmppTransport
): Map<string, CacheEntry<T>> {
  let cache = caches.get(conn)
  if (!cache) {
    cache = new Map()
    caches.set(conn, cache)
  }
  return cache
}

// the caps cache is only reachable when indexedDB exists (tests run
// without it and simply skip persistence)
const hasIdb = typeof indexedDB !== 'undefined'

function capsKey(ver: string): string {
  return globalKey('caps', ver)
}

// a node of the form base#ver points at a caps verification string; its
// disco#info answer is cacheable by ver across contacts and sessions
function verFromNode(node: string | undefined): string | undefined {
  if (!node) return undefined
  const at = node.indexOf('#')
  return at > 0 ? node.slice(at + 1) : undefined
}

async function loadCaps(ver: string): Promise<DiscoInfo | null> {
  if (!hasIdb) return null
  try {
    return (await idb.get<DiscoInfo>('kv', capsKey(ver))) ?? null
  } catch {
    return null
  }
}

function persistCaps(ver: string, info: DiscoInfo): void {
  if (!hasIdb) return
  void idb.set('kv', capsKey(ver), info).catch(() => undefined)
}

function sendInfoQuery(
  conn: XmppTransport,
  jid: string,
  node: string | undefined,
  finish: (info: DiscoInfo | null) => void
): void {
  let settled = false
  const done = (info: DiscoInfo | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    finish(info)
  }
  const timer = setTimeout(() => done(null), DISCO_TIMEOUT_MS)
  const queryAttrs: Record<string, string> = { xmlns: NS.DISCO_INFO }
  if (node) queryAttrs.node = node
  conn.sendIq(
    $iq({ type: 'get', to: jid, id: conn.uniqueId('disco-info') }).c('query', queryAttrs),
    (stanza) => done(parseDiscoInfo(stanza)),
    () => done(null)
  )
}

// disco#info for a jid, optionally at a node. Results are cached per
// connection for the session; a node of the form base#ver additionally
// persists under the caps ver so repeat lookups across contacts that
// share a client are free.
export function discoInfo(
  conn: XmppTransport,
  jid: string,
  node: string | undefined,
  onDone: (info: DiscoInfo | null) => void
): void {
  const cache = cacheFor(infoCaches, conn)
  const key = `${jid}${node ?? ''}`
  const hit = cache.get(key)
  if (hit) {
    if (hit.waiters) {
      hit.waiters.push(onDone)
      return
    }
    if (hit.value !== null || Date.now() - hit.at < DISCO_NEGATIVE_TTL_MS) {
      onDone(hit.value)
      return
    }
  }
  const entry: CacheEntry<DiscoInfo> = { value: null, at: 0, waiters: [onDone] }
  cache.set(key, entry)
  const finish = (info: DiscoInfo | null) => {
    const waiters = entry.waiters ?? []
    entry.waiters = undefined
    entry.value = info
    entry.at = Date.now()
    const ver = verFromNode(node)
    if (info && ver) persistCaps(ver, info)
    for (const cb of waiters) cb(info)
  }
  const ver = verFromNode(node)
  if (ver) {
    void loadCaps(ver).then((cached) => {
      if (cached) {
        finish(cached)
      } else {
        sendInfoQuery(conn, jid, node, finish)
      }
    })
    return
  }
  sendInfoQuery(conn, jid, node, finish)
}

// disco#items for a jid, session cached like discoInfo.
export function discoItems(
  conn: XmppTransport,
  jid: string,
  onDone: (items: DiscoItem[] | null) => void
): void {
  const cache = cacheFor(itemCaches, conn)
  const hit = cache.get(jid)
  if (hit) {
    if (hit.waiters) {
      hit.waiters.push(onDone)
      return
    }
    if (hit.value !== null || Date.now() - hit.at < DISCO_NEGATIVE_TTL_MS) {
      onDone(hit.value)
      return
    }
  }
  const entry: CacheEntry<DiscoItem[]> = { value: null, at: 0, waiters: [onDone] }
  cache.set(jid, entry)
  let settled = false
  const done = (items: DiscoItem[] | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    const waiters = entry.waiters ?? []
    entry.waiters = undefined
    entry.value = items
    entry.at = Date.now()
    for (const cb of waiters) cb(items)
  }
  const timer = setTimeout(() => done(null), DISCO_TIMEOUT_MS)
  conn.sendIq(
    $iq({ type: 'get', to: jid, id: conn.uniqueId('disco-items') }).c('query', {
      xmlns: NS.DISCO_ITEMS
    }),
    (stanza) => done(parseDiscoItems(stanza)),
    () => done(null)
  )
}

// ---- answering disco queries addressed to us -----------------------------

function replyQuery(
  conn: XmppTransport,
  stanza: Element,
  xmlns: string,
  fill: (query: ReturnType<typeof $iq>) => void
): boolean {
  const from = stanza.getAttribute('from')
  const attrs: Record<string, string> = { type: 'result', id: stanza.getAttribute('id') ?? '' }
  if (from) attrs.to = from
  const reply = $iq(attrs)
  const queryAttrs: Record<string, string> = { xmlns }
  const node = firstNsTag(stanza, xmlns, 'query')?.getAttribute('node')
  if (node) queryAttrs.node = node
  reply.c('query', queryAttrs)
  fill(reply)
  conn.send(reply)
  return true
}

// iq get handler for disco#info: our identity plus the shared feature
// registry. The same answer serves bare-node queries and the caps node
// of the form CAPS_NODE#ver; any other node gets item-not-found per
// XEP-0030 section 3.1.
export function answerDiscoInfo(conn: XmppTransport, stanza: Element): boolean {
  const node = firstNsTag(stanza, NS.DISCO_INFO, 'query')?.getAttribute('node')
  const ownNode = `${CAPS_NODE}#${ownCaps().ver}`
  if (node && node !== ownNode) {
    const from = stanza.getAttribute('from')
    const attrs: Record<string, string> = {
      type: 'error',
      id: stanza.getAttribute('id') ?? ''
    }
    if (from) attrs.to = from
    conn.send(
      $iq(attrs)
        .c('query', { xmlns: NS.DISCO_INFO, node })
        .up()
        .c('error', { type: 'cancel' })
        .c('item-not-found', { xmlns: NS.STANZA_ERRORS })
    )
    return true
  }
  return replyQuery(conn, stanza, NS.DISCO_INFO, (query) => {
    query
      .c('identity', {
        category: DISCO_IDENTITY.category,
        type: DISCO_IDENTITY.type,
        name: DISCO_IDENTITY.name ?? ''
      })
      .up()
    for (const feature of DISCO_FEATURES) query.c('feature', { var: feature }).up()
  })
}

// iq get handler for disco#items: we host no components, so the list is
// legitimately empty.
export function answerDiscoItems(conn: XmppTransport, stanza: Element): boolean {
  return replyQuery(conn, stanza, NS.DISCO_ITEMS, () => undefined)
}
