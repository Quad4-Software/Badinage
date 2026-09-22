// Option and capability types of the transport contract: vcard access,
// connection status, capability flags and send-time options. The
// ChatConnection interface that references them lives in connection.ts
// in this folder.

import type { Geoloc, MessageReference, Vcard } from '../stanzas'

// XEP-0054 vcard. fetch resolves null when the server has no card or
// refuses the query. fetchPeer does the same for any jid (contact or
// room/nick occupant). Set merges the managed fields over the stored
// card and stamps the XEP-0153 photo hash onto presence broadcasts.
export interface VcardApi {
  fetch(onDone: (vcard: Vcard | null) => void): void
  fetchPeer(jid: string, onDone: (vcard: Vcard | null) => void): void
  set(vcard: Vcard, onDone: (ok: boolean) => void): void
}

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'authfail' | 'error'

// What a transport can actually do. XMPP transports leave capabilities
// undefined and get the full feature set. IRC declares a narrower one so
// the ui can hide controls that would dead-end. Every flag reads as
// `capabilities?.x !== false` so an absent field means supported.
export interface TransportCapabilities {
  // OMEMO e2ee, HTTP upload, roster, presence subscriptions, vcard
  // profile editing, MUC owner config forms, in-band registration. IRC:
  // none of those apply and MONITOR is the roster approximation
  e2ee: boolean
  upload: boolean
  roster: boolean
  subscriptions: boolean
  profile: boolean
  roomConfig: boolean
  registration: boolean
}

// chat = dm, groupchat = muc message type on the wire
export type ChatKind = 'chat' | 'groupchat'

// XEP-0461 reply target: id is the replied-to stanza id, plus its author
// jid. The author can be named to (wire attribute style) or from (the
// field name used by the parsed IncomingMessage replyTo shape).
type ReplyRef =
  { id: string; to: string } | { id: string; from: string; quote?: string | undefined }

export interface SendMessageOptions {
  replyTo?: ReplyRef | undefined
  // XEP-0308: id of the stanza this message corrects
  replaceId?: string | undefined
  // XEP-0382: mark the body as a spoiler. The string is the optional
  // hint shown before reveal, empty for a hintless spoiler
  spoilerHint?: string | undefined
  // XEP-0466: ephemeral timer in seconds attached to this message
  ephemeral?: number | undefined
  // XEP-0372 body-range references (mentions). Positions are code points
  references?: MessageReference[] | undefined
  // XEP-0080 location payload. A geo: uri body fallback is added by the
  // sender, so callers only pass coordinates
  geoloc?: Geoloc | undefined
}

// XEP-0446 file metadata, all fields optional on the wire.
export interface AttachmentMeta {
  name?: string | undefined
  mediaType?: string | undefined
  size?: number | undefined
  duration?: number | undefined
}
