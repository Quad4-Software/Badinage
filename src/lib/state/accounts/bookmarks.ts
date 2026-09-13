// XEP-0402 bookmark handling for Account: the optimistic map updates,
// the refetch-on-failure refetch, the notify-override sync and the
// autojoin pass. Free functions so accounts.svelte.ts stays under the
// size gate. The Account methods delegate here.

import type { Bookmark } from '$lib/core/xmpp/stanzas'
import { bareJid, parseJid } from '$lib/utils/jid'

import type { Account } from '../accounts.svelte'

// The notification payload is deliberately not trusted: races between
// resources are resolved by refetching the whole node, last write wins.
export function refreshBookmarks(account: Account, autoJoined: Set<string>): void {
  if (account.status !== 'connected') return
  account.connection.fetchBookmarks((bookmarks) => applyBookmarks(account, autoJoined, bookmarks))
}

export function addBookmark(account: Account, autoJoined: Set<string>, bookmark: Bookmark): void {
  const stored = { ...bookmark, jid: bareJid(bookmark.jid) }
  // optimistic: the server push resyncs every resource anyway, and a
  // failed publish triggers a refetch that restores server truth
  account.bookmarks.set(stored.jid, stored)
  account.connection.addBookmark(stored, (ok) => {
    if (!ok) refreshBookmarks(account, autoJoined)
  })
}

export function removeBookmark(account: Account, autoJoined: Set<string>, jid: string): void {
  account.bookmarks.delete(bareJid(jid))
  account.connection.removeBookmark(bareJid(jid), (ok) => {
    if (!ok) refreshBookmarks(account, autoJoined)
  })
}

// XEP-0492: sync a notification override onto the bookmark carrying
// the conversation, preserving any extensions we did not author. Only
// bookmarked chats sync. Unbookmarked dms keep a local-only setting.
export function setBookmarkNotify(
  account: Account,
  autoJoined: Set<string>,
  jid: string,
  notify: Bookmark['notify']
): void {
  const existing = account.bookmarks.get(bareJid(jid))
  if (!existing) return
  addBookmark(account, autoJoined, { ...existing, notify })
}

export function applyBookmarks(
  account: Account,
  autoJoined: Set<string>,
  bookmarks: Bookmark[] | null
): void {
  // null means the server has no PEP: stay a graceful no-op
  if (bookmarks === null) return
  account.bookmarks.clear()
  for (const bookmark of bookmarks) {
    account.bookmarks.set(bareJid(bookmark.jid), bookmark)
  }
  account.onBookmarksApplied?.(bookmarks)
  for (const bookmark of bookmarks) {
    if (bookmark.kind !== 'conference' || !bookmark.autojoin) continue
    const room = bareJid(bookmark.jid)
    // once per session per room: a notify refetch must not rejoin a
    // room the user deliberately left
    if (autoJoined.has(room)) continue
    autoJoined.add(room)
    account.joinRoom(room, bookmark.nick || parseJid(account.jid).local || 'me', bookmark.password)
  }
}
