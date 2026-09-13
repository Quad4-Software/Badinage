// Message-body search over the conversations already loaded in memory.
// Server-side archive search (MAM) is a follow-up: it needs result paging
// and fetching history around a hit, so the palette only scans the local
// window for now.

export interface SearchableConversation {
  peerJid: string
  messages: { id: string; body: string; timestamp: number }[]
}

export interface MessageHit {
  peerJid: string
  messageId: string
  // display window around the first matching token
  snippet: string
  // full body kept so the palette ranker can re-match every token
  body: string
  timestamp: number
}

// characters of context kept on each side of the first token hit
const SNIPPET_RADIUS = 40
// below this the body scan is off. Single letters hit far too much
export const MIN_SEARCH_CHARS = 2

function tokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

function snippetAround(body: string, token: string): string {
  const clean = body.replace(/\s+/g, ' ').trim()
  const at = clean.toLowerCase().indexOf(token)
  if (at === -1) return clean.slice(0, SNIPPET_RADIUS * 2)
  const from = Math.max(0, at - SNIPPET_RADIUS)
  const to = Math.min(clean.length, at + token.length + SNIPPET_RADIUS)
  return `${from > 0 ? '…' : ''}${clean.slice(from, to)}${to < clean.length ? '…' : ''}`
}

// Every query token must appear in the body. Hits come back newest first
// and capped at limit.
export function findMessageHits(
  conversations: SearchableConversation[],
  query: string,
  limit: number
): MessageHit[] {
  const wanted = tokens(query)
  if (wanted.length === 0 || query.trim().length < MIN_SEARCH_CHARS || limit <= 0) return []
  const hits: MessageHit[] = []
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (!message.body) continue
      const body = message.body.toLowerCase()
      if (!wanted.every((token) => body.includes(token))) continue
      hits.push({
        peerJid: conversation.peerJid,
        messageId: message.id,
        snippet: snippetAround(message.body, wanted[0] ?? ''),
        body: message.body,
        timestamp: message.timestamp
      })
    }
  }
  hits.sort((a, b) => b.timestamp - a.timestamp)
  return hits.slice(0, limit)
}
