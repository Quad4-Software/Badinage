// PEP event parsing: the pubsub event envelope, bookmark items and the
// notify extension.

import { allNsTags, allTags, childElements, firstNsTag, serializeElement } from '$lib/utils/xml'

import { NS } from '../ns'
import type { Bookmark, NotifySetting } from './types'

export function parsePepEvent(
  stanza: Element
): { node: string; items: Element[]; retracted: string[] } | null {
  const event = firstNsTag(stanza, NS.PUBSUB_EVENT, 'event')
  const items = event ? firstNsTag(event, NS.PUBSUB_EVENT, 'items') : null
  if (!items) return null
  return {
    node: items.getAttribute('node') ?? '',
    items: allTags(items, 'item'),
    retracted: allNsTags(items, NS.PUBSUB_EVENT, 'retract').map((r) => r.getAttribute('id') ?? '')
  }
}

// One pubsub item element carrying a bookmark payload. The item id is the
// bookmarked jid; the conference element may also carry a jid attribute
// in older payloads so both are accepted.
// XEP-0492: the notify element under a bookmark extensions wrapper.
// When several settings carry identity attributes we use the bare
// fallback element; without one the first present setting wins.
function parseNotify(host: Element | null): {
  notify?: NotifySetting | undefined
  extensionsXml: string[]
} {
  const extensionsXml: string[] = []
  if (!host) return { extensionsXml }
  const extensions = firstNsTag(host, NS.BOOKMARKS, 'extensions')
  if (!extensions) return { extensionsXml }
  const notifyEls = allNsTags(extensions, NS.NOTIFY, 'notify')
  let notify: NotifySetting | undefined
  for (const notifyEl of notifyEls) {
    for (const setting of childElements(notifyEl)) {
      const name = setting.localName
      if (name !== 'always' && name !== 'on-mention' && name !== 'never') continue
      const fallback = !setting.getAttribute('identity-category')
      if (fallback || notify === undefined) notify = name
    }
  }
  for (const child of childElements(extensions)) {
    if (child.localName === 'notify' && child.namespaceURI === NS.NOTIFY) continue
    extensionsXml.push(serializeElement(child))
  }
  return { notify, extensionsXml }
}

export function parseBookmark(item: Element): Bookmark | null {
  const id = item.getAttribute('id') ?? ''
  const conference = firstNsTag(item, NS.BOOKMARKS, 'conference')
  if (conference) {
    const { notify, extensionsXml } = parseNotify(conference)
    return {
      jid: id || (conference.getAttribute('jid') ?? ''),
      kind: 'conference',
      name: conference.getAttribute('name') ?? undefined,
      autojoin: conference.getAttribute('autojoin') === 'true',
      nick: firstNsTag(conference, NS.BOOKMARKS, 'nick')?.textContent ?? undefined,
      password: firstNsTag(conference, NS.BOOKMARKS, 'password')?.textContent ?? undefined,
      notify,
      extensionsXml: extensionsXml.length > 0 ? extensionsXml : undefined
    }
  }
  const contact = firstNsTag(item, NS.BOOKMARKS, 'contact')
  if (contact) {
    const { notify, extensionsXml } = parseNotify(contact)
    return {
      jid: id || (contact.getAttribute('jid') ?? ''),
      kind: 'contact',
      name: contact.getAttribute('name') ?? undefined,
      notify,
      extensionsXml: extensionsXml.length > 0 ? extensionsXml : undefined
    }
  }
  return null
}

// All bookmark items under an items container (pubsub result or event).
export function parseBookmarkItems(items: Element): Bookmark[] {
  const out: Bookmark[] = []
  for (const item of allTags(items, 'item')) {
    const bookmark = parseBookmark(item)
    if (bookmark?.jid) out.push(bookmark)
  }
  return out
}

// XEP-0490: one mds item holds the last displayed stanza for the peer
// jid named by the item id. The displayed wrapper nests the referenced
// stanza-id with the assigning entity echoed back in by.
