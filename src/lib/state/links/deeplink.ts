// Deep link entry points: the web+xmpp protocol handler lands on
// ?uri=<xmpp-uri>, the in-app route form is #/xmpp/<encoded-uri>, and
// share_target payloads wait in IndexedDB until the app drains them.
import { takeShare } from '$lib/core/storage/share'
import type { SharePayload } from '$lib/core/storage/share'
import { parseXmppUri } from '$lib/utils/protocol/xmpp-uri'

export type { SharePayload }

export type DeepLink =
  | { kind: 'message'; jid: string; body?: string | undefined }
  | { kind: 'join'; jid: string }
  | { kind: 'roster'; jid: string; name?: string | undefined }

const HASH_PREFIX = '#/xmpp/'

// Resolve a deep link to an action. Unknown and unsafe xmpp actions
// (invite, remove, ...) return null instead of guessing.
export function parseDeepLink(url: URL, hash: string): DeepLink | null {
  let uri: string | null
  if (hash.startsWith(HASH_PREFIX)) {
    try {
      uri = decodeURIComponent(hash.slice(HASH_PREFIX.length))
    } catch {
      return null
    }
  } else {
    uri = url.searchParams.get('uri')
  }
  if (!uri) return null
  const parsed = parseXmppUri(uri)
  if (!parsed) return null
  switch (parsed.action) {
    case 'message':
      return { kind: 'message', jid: parsed.jid, body: parsed.params.body }
    case 'join':
      return { kind: 'join', jid: parsed.jid }
    case 'roster':
    case 'subscribe':
    case '':
      return { kind: 'roster', jid: parsed.jid, name: parsed.params.name }
    default:
      return null
  }
}

// share_target POSTs land in IndexedDB before the app exists. Ui
// consumers drain the inbox through here
export function shareInbox(): Promise<SharePayload | null> {
  return takeShare()
}
