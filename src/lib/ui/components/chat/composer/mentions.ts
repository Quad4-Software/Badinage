// XEP-0372 mention completion for the composer: @nick tokens in a room
// match current occupants and become mention references on send.
// Positions count Unicode code points per the spec.

import type { MessageReference } from '$lib/core/xmpp/stanzas'
import type { Conversation, ConversationKind } from '$lib/state/chats.svelte'

export function mentionRefs(
  conversation: Conversation | undefined,
  kind: ConversationKind,
  text: string
): MessageReference[] | undefined {
  if (kind !== 'muc' || !conversation) return undefined
  const refs: MessageReference[] = []
  const re = /(^|\s)@([^\s@]+)/g
  for (const match of text.matchAll(re)) {
    const nick = match[2] ?? ''
    const occupant = [...conversation.occupants.keys()].find(
      (n) => n.toLowerCase() === nick.toLowerCase()
    )
    if (!occupant) continue
    const at = (match.index ?? 0) + (match[1]?.length ?? 0) + 1
    const begin = [...text.slice(0, at)].length
    refs.push({
      type: 'mention',
      begin,
      end: begin + [...nick].length,
      uri: `xmpp:${conversation.peerJid}/${occupant}`
    })
  }
  return refs.length > 0 ? refs : undefined
}

// the @token under the cursor, or null when the caret is not completing
export function mentionToken(body: string, cursor: number): { start: number; text: string } | null {
  const before = body.slice(0, cursor)
  const match = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!match) return null
  return { start: cursor - (match[2]?.length ?? 0), text: match[2] ?? '' }
}

export function mentionCandidates(
  conversation: Conversation | undefined,
  query: { start: number; text: string } | null
): string[] {
  if (query === null || !conversation) return []
  return [...conversation.occupants.keys()]
    .filter(
      (nick) =>
        nick !== conversation.ourNick && nick.toLowerCase().startsWith(query.text.toLowerCase())
    )
    .slice(0, 8)
}
