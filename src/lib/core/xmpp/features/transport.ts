// The narrow transport surface the feature modules (mam, upload, pep,
// blocking, muc) program against. XmppConnection adapts its Strophe
// connection into this shape and hands it to those functions, so they
// never touch Strophe.Connection directly.

import type { $iq } from 'strophe.js'

export type StanzaBuilder = ReturnType<typeof $iq>

export interface XmppTransport {
  sendIq(
    stanza: StanzaBuilder,
    onResult: (stanza: Element) => void,
    onError?: (stanza: Element | null) => void
  ): void
  send(stanza: StanzaBuilder): void
  uniqueId(prefix: string): string
  readonly jid: string
}

export function noop(): void {
  // intentional no-op for iq responses we do not need to inspect
}
