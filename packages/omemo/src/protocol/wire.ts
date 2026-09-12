// Wire format for encrypted elements and device lists.
//
// omemo:2:
// <encrypted xmlns='urn:xmpp:omemo:2'>
//   <header sid='N'><keys jid='bare'><key rid='N' kex='true'>B64</key></keys></header>
//   <payload>B64</payload>
// </encrypted>
//
// legacy:
// <encrypted xmlns='eu.siacs.conversations.axolotl'>
//   <header sid='N'><key rid='N' prekey='true'>B64</key><iv>B64</iv></header>
//   <payload>B64</payload>
// </encrypted>

import { NAMESPACES } from '../constants'
import type { Namespace } from '../constants'
import { ParseError } from '../errors'
import { base64Decode, base64Encode } from '../internal/bytes'
import { childrenNamed, el, findChild, serializeXml } from '../internal/xml'
import type { XmlElement } from '../internal/xml'
import { looksLikeKeyExchange } from './keyExchange'

export interface WireKey {
  rid: number
  jid: string | undefined
  kex: boolean
  data: Uint8Array
}

export interface ParsedEncrypted {
  namespace: Namespace
  sid: number
  keys: WireKey[]
  payload: Uint8Array | undefined
  iv: Uint8Array | undefined
}

export interface EncryptOutputKey {
  rid: number
  jid: string
  data: Uint8Array
  kex: boolean
}

export function buildEncryptedElement(args: {
  namespace: Namespace
  sid: number
  keys: EncryptOutputKey[]
  payload?: Uint8Array
  iv?: Uint8Array
}): XmlElement {
  const ns = NAMESPACES[args.namespace].element
  const headerAttrs = { sid: String(args.sid) }

  if (args.namespace === 'omemo2') {
    const byJid = new Map<string, EncryptOutputKey[]>()
    for (const key of args.keys) {
      const list = byJid.get(key.jid) ?? []
      list.push(key)
      byJid.set(key.jid, list)
    }
    const keysElts = [...byJid].map(([jid, keys]) =>
      el(
        'keys',
        { jid },
        keys.map((key) => {
          const attrs: Record<string, string> = { rid: String(key.rid) }
          if (key.kex) attrs['kex'] = 'true'
          return el('key', attrs, [], base64Encode(key.data))
        })
      )
    )
    const children: XmlElement[] = [el('header', headerAttrs, keysElts)]
    if (args.payload !== undefined) {
      children.push(el('payload', {}, [], base64Encode(args.payload)))
    }
    return el('encrypted', { xmlns: ns }, children)
  }

  const headerChildren: XmlElement[] = args.keys.map((key) => {
    const attrs: Record<string, string> = { rid: String(key.rid) }
    if (key.kex) attrs['prekey'] = 'true'
    return el('key', attrs, [], base64Encode(key.data))
  })
  headerChildren.push(el('iv', {}, [], base64Encode(args.iv ?? new Uint8Array(0))))
  const children: XmlElement[] = [el('header', headerAttrs, headerChildren)]
  if (args.payload !== undefined) {
    children.push(el('payload', {}, [], base64Encode(args.payload)))
  }
  return el('encrypted', { xmlns: ns }, children)
}

export function serializeEncrypted(element: XmlElement): string {
  return serializeXml(element)
}

export function parseEncryptedElement(element: XmlElement, namespace: Namespace): ParsedEncrypted {
  if (element.name !== 'encrypted') throw new ParseError('expected <encrypted>')
  const header = findChild(element, 'header')
  if (!header) throw new ParseError('encrypted: missing <header>')
  const sidAttr = header.attrs['sid']
  if (sidAttr === undefined) throw new ParseError('encrypted: missing sid')
  const sid = Number.parseInt(sidAttr, 10)
  if (!Number.isInteger(sid) || sid < 0) throw new ParseError('encrypted: invalid sid')

  const keys: WireKey[] = []
  if (namespace === 'omemo2') {
    for (const keysElt of childrenNamed(header, 'keys')) {
      const jid = keysElt.attrs['jid']
      for (const keyElt of childrenNamed(keysElt, 'key')) {
        keys.push(parseKey(keyElt, jid, 'kex'))
      }
    }
    // Be liberal: also accept bare key elements under the header
    for (const keyElt of childrenNamed(header, 'key')) {
      keys.push(parseKey(keyElt, undefined, 'kex'))
    }
  } else {
    for (const keyElt of childrenNamed(header, 'key')) {
      keys.push(parseKey(keyElt, undefined, 'prekey'))
    }
  }

  const payloadElt = findChild(element, 'payload')
  const ivElt = findChild(header, 'iv')
  return {
    namespace,
    sid,
    keys,
    payload: payloadElt ? base64Decode(payloadElt.text) : undefined,
    iv: ivElt ? base64Decode(ivElt.text) : undefined
  }
}

function parseKey(element: XmlElement, jid: string | undefined, kexAttr: string): WireKey {
  const ridAttr = element.attrs['rid']
  if (ridAttr === undefined) throw new ParseError('key: missing rid')
  const rid = Number.parseInt(ridAttr, 10)
  if (!Number.isInteger(rid) || rid < 0) throw new ParseError('key: invalid rid')
  const data = base64Decode(element.text)
  const attr = element.attrs[kexAttr]
  const kex =
    attr === 'true' ||
    attr === '1' ||
    (attr === undefined && looksLikeKeyExchange(kexAttr === 'kex' ? 'omemo2' : 'legacy', data))
  return { rid, jid, kex, data }
}

// Device lists
export function buildDeviceListElement(namespace: Namespace, deviceIds: number[]): XmlElement {
  if (namespace === 'omemo2') {
    return el(
      'devices',
      { xmlns: NAMESPACES.omemo2.element },
      deviceIds.map((id) => el('device', { id: String(id) }))
    )
  }
  return el(
    'list',
    { xmlns: NAMESPACES.legacy.devices },
    deviceIds.map((id) => el('device', { id: String(id) }))
  )
}

export function serializeDeviceList(namespace: Namespace, deviceIds: number[]): string {
  return serializeXml(buildDeviceListElement(namespace, deviceIds))
}

export function parseDeviceList(element: XmlElement): number[] {
  if (element.name !== 'devices' && element.name !== 'list') {
    throw new ParseError('expected device list element')
  }
  const ids: number[] = []
  for (const device of childrenNamed(element, 'device')) {
    const raw = device.attrs['id']
    if (raw === undefined) continue
    const id = Number.parseInt(raw, 10)
    if (Number.isInteger(id) && id >= 0) ids.push(id)
  }
  return ids
}
