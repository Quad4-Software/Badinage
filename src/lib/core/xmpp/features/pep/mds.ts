// XEP-0490 message displayed synchronization: a private PEP node with
// one item per conversation peer holding the stanza-id we last showed.
// Other connected resources read it to clear their unread counters.

import { escapeXml } from '$lib/utils/xml'

import { NS } from '../../ns'
import { pepPublish, type PepPublishOptions } from './pep'
import type { XmppTransport } from '../transport'

// the node is account-private: whitelist access, never push the last
// item to new presences before they ask
const MDS_PUBLISH_OPTIONS: PepPublishOptions = {
  persistItems: true,
  maxItems: 'max',
  sendLastPublishedItem: 'never',
  accessModel: 'whitelist'
}

// displayed element wrapping the stanza-id; by echoes back the entity
// that assigned the id (the room for muc, the sender's server for dm)
function mdsPayload(stanzaId: string, by?: string): string {
  const byAttr = by ? ` by="${escapeXml(by)}"` : ''
  return (
    `<displayed xmlns="${NS.MDS}">` +
    `<stanza-id xmlns="${NS.STANZA_IDS}"${byAttr} id="${escapeXml(stanzaId)}"/>` +
    `</displayed>`
  )
}

// publish (or overwrite) the displayed marker for one peer; the item id
// is the peer's bare jid so each conversation gets one slot
export function publishDisplayed(
  conn: XmppTransport,
  peerJid: string,
  stanzaId: string,
  by?: string,
  onDone?: (ok: boolean) => void
): void {
  pepPublish(conn, NS.MDS, peerJid, mdsPayload(stanzaId, by), MDS_PUBLISH_OPTIONS, onDone)
}
