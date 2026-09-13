// XEP-0402 PEP native bookmarks: one pubsub item per bookmark on the
// urn:xmpp:bookmarks:1 node. Conferences follow the spec payload;
// contacts serialize as a contact element, a client-local extension
// since the spec only defines conference items.

import { $iq } from 'strophe.js'

import { escapeXml } from '$lib/utils/xml'

import { NS } from '../../ns'
import { parseBookmarkItems, type Bookmark } from '../../stanzas'
import { pepGet, pepPublish, type PepPublishOptions } from './pep'
import type { XmppTransport } from '../transport'

// XEP-0402 section 3.3: publish-options must keep the node persistent
// and private; whitelist keeps bookmarks invisible to contacts
const BOOKMARK_PUBLISH_OPTIONS: PepPublishOptions = {
  persistItems: true,
  maxItems: 'max',
  sendLastPublishedItem: 'never',
  accessModel: 'whitelist'
}

// the item payload without the wrapping <item>: one conference or
// contact element in the bookmarks namespace
export function bookmarkPayload(bookmark: Bookmark): string {
  const name = bookmark.name ? ` name="${escapeXml(bookmark.name)}"` : ''
  if (bookmark.kind === 'contact') {
    return `<contact xmlns="${NS.BOOKMARKS}"${name}/>`
  }
  const autojoin = bookmark.autojoin ? ' autojoin="true"' : ''
  let inner = ''
  if (bookmark.nick) inner += `<nick>${escapeXml(bookmark.nick)}</nick>`
  if (bookmark.password) inner += `<password>${escapeXml(bookmark.password)}</password>`
  return `<conference xmlns="${NS.BOOKMARKS}"${name}${autojoin}>${inner}</conference>`
}

// resolves with the stored bookmarks, or null when the node fetch fails
// (servers without PEP, item-not-found on an empty node, timeouts)
export function fetchBookmarks(
  conn: XmppTransport,
  onDone: (bookmarks: Bookmark[] | null) => void
): void {
  pepGet(conn, NS.BOOKMARKS, undefined, (items) => {
    onDone(items ? parseBookmarkItems(items) : null)
  })
}

// publish or overwrite one bookmark; the item id is the bookmarked jid
export function publishBookmark(
  conn: XmppTransport,
  bookmark: Bookmark,
  onDone?: (ok: boolean) => void
): void {
  pepPublish(
    conn,
    NS.BOOKMARKS,
    bookmark.jid,
    bookmarkPayload(bookmark),
    BOOKMARK_PUBLISH_OPTIONS,
    onDone
  )
}

// retract by item id; notify=true tells the server to inform our other
// online resources so they refresh too
export function retractBookmark(
  conn: XmppTransport,
  jid: string,
  onDone?: (ok: boolean) => void
): void {
  conn.sendIq(
    $iq({ type: 'set', id: conn.uniqueId('bookmark-del') })
      .c('pubsub', { xmlns: NS.PUBSUB })
      .c('retract', { node: NS.BOOKMARKS, notify: 'true' })
      .c('item', { id: jid }),
    () => onDone?.(true),
    () => onDone?.(false)
  )
}
