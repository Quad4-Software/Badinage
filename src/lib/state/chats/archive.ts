// MAM archive paging (XEP-0313) extracted from ChatStore so the class
// file stays under the size gate.

import { MESSAGE_PAGE_SIZE } from '$lib/constants'
import type { ChatConnection } from '$lib/core/xmpp/connection'

import type { Conversation } from '../conversation.svelte'

// Fetch the next older archive page. No-ops while a page is in flight
// or once the archive is exhausted. With no cursor yet the server
// returns its latest page, which is what the initial selectPeer fetch
// uses too.
export function loadOlder(conversation: Conversation, connection: ChatConnection): void {
  if (!connection.connected) return
  if (conversation.historyLoading || conversation.historyComplete) return
  conversation.historyLoading = true
  connection.queryArchive(
    conversation.peerJid,
    {
      max: MESSAGE_PAGE_SIZE,
      before: conversation.historyCursor,
      room: conversation.kind === 'muc'
    },
    // the rsm cursor moves to the page's first uid. The archive is
    // treated as exhausted when the fin says complete or the page
    // carried no first uid to page before
    (result) => {
      conversation.historyCursor = result.first
      conversation.historyComplete = result.complete || !result.first
      conversation.historyLoading = false
    }
  )
}
