// PEP plumbing for OMEMO device lists and bundles: fetch a node, parse
// it, and fall back to the last persisted list when the fetch fails.
// Pure functions over the connection and crypto facade so service.ts
// stays focused on session and envelope logic.

import { NAMESPACES, parseDeviceList, parseXml } from '@quad4-software/badinage-omemo'
import type { Namespace, ParsedBundle, XmlElement } from '@quad4-software/badinage-omemo'

import type { ChatConnection } from '$lib/core/xmpp/connection'
import { bareJid } from '$lib/utils/jid'
import { firstTag } from '$lib/utils/xml'

import type { OmemoCrypto } from './worker/crypto'

// Bridge a DOM element to the package's own XmlElement via its xml text
function domToXml(element: Element): XmlElement {
  const outer = (element as { outerHTML?: string }).outerHTML
  const text = outer ?? (element as unknown as { toString(): string }).toString()
  return parseXml(text)
}

function pepItems(connection: ChatConnection, node: string, jid?: string): Promise<Element | null> {
  return new Promise((resolve) => {
    connection.pepGet(node, jid, (items) => resolve(items))
  })
}

// The PEP device list of a bare JID for one profile. Falls back to the
// last persisted list when the fetch fails.
export async function devicesOfNs(
  crypto: OmemoCrypto,
  connection: ChatConnection,
  ns: Namespace,
  jid: string
): Promise<number[]> {
  const bare = bareJid(jid)
  const items = await pepItems(connection, NAMESPACES[ns].devices, bare)
  const listEl = items === null ? null : (firstTag(items, 'devices') ?? firstTag(items, 'list'))
  if (listEl) {
    try {
      const ids = parseDeviceList(domToXml(listEl))
      await crypto.putDeviceIds(ns, bare, ids)
      return ids
    } catch (error) {
      // fall through to the cached list
      console.warn(
        `omemo: failed to parse device list for ${bare}:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  return (await crypto.getDeviceIds(ns, bare)) ?? []
}

export async function bundleOfNs(
  crypto: OmemoCrypto,
  connection: ChatConnection,
  ns: Namespace,
  jid: string,
  deviceId: number
): Promise<ParsedBundle | undefined> {
  const bare = bareJid(jid)
  const items = await pepItems(connection, `${NAMESPACES[ns].bundles}:${deviceId}`, bare)
  const bundleEl = items === null ? null : firstTag(items, 'bundle')
  if (!bundleEl) return undefined
  try {
    return await crypto.parseBundle(ns, domToXml(bundleEl))
  } catch (error) {
    console.warn(
      `omemo: failed to parse bundle for ${bare}/${deviceId}:`,
      error instanceof Error ? error.message : String(error)
    )
    return undefined
  }
}
