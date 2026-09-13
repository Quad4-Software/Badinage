// Live-message fan-out: build the LiveMessage notification and advance
// the XEP-0490 displayed marker while a conversation is open. Free
// functions so app.svelte.ts stays under the size gate.

import type { Attachment, IncomingMessage } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

import type { Account } from '../accounts.svelte'
import type { ChatMessage, ChatStore } from '../chats.svelte'

// one live incoming message, resolved for ui consumers (notifications,
// aria-live). sender is already display-ready and encrypted is precomputed
// so listeners never need to look up roster or conversation state.
export interface LiveMessage {
  accountJid: string
  peer: string
  sender: string
  // true when the stanza or conversation is omemo-encrypted: listeners
  // must show a generic label instead of the body
  encrypted: boolean
  body: string
  attachment?: Attachment | undefined
  // XEP-0224: the stanza asked for attention; listeners decide how loud
  attention?: boolean | undefined
  // XEP-0372/0492: the incoming muc message mentioned us
  mentioned?: boolean | undefined
}

export function buildLiveEvent(
  accountList: Account[],
  chats: Map<string, ChatStore>,
  accountJid: string,
  peer: string,
  message: IncomingMessage,
  stored?: ChatMessage
): LiveMessage {
  const account = accountList.find((a) => a.jid === accountJid)
  const conversation = chats.get(accountJid)?.conversations.get(peer)
  const rosterName = account?.roster.find((c) => c.jid === bareJid(message.from))?.name
  return {
    accountJid,
    peer,
    sender:
      message.type === 'groupchat' ? (message.nick ?? peer) : rosterName || bareJid(message.from),
    encrypted: Boolean(message.encrypted || message.undecryptable || conversation?.encrypted),
    body: message.body,
    attachment: message.attachments?.[0],
    attention: message.attention === true,
    // only a stored row can carry a computed mention flag; a bodiless
    // signal stanza (attention) leaves the previous row last and must
    // not inherit its mentionsMe
    mentioned: stored?.mentionsMe === true
  }
}

// mdsPublished is the caller's map of the last stanza-id published per
// account:peer so we do not republish the same marker on every
// selectPeer/live message
export function publishDisplayed(
  mdsPublished: Map<string, string>,
  account: Account | null,
  peer: string,
  stanzaId: string,
  by?: string | undefined
): void {
  if (!account || account.status !== 'connected') return
  const key = `${account.jid}:${peer}`
  if (mdsPublished.get(key) === stanzaId) return
  account.connection.publishDisplayed(peer, stanzaId, by, (ok) => {
    if (ok) mdsPublished.set(key, stanzaId)
  })
}
