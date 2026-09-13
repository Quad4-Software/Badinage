// The public contract of the XMPP transport layer: the ChatConnection
// interface the state layer programs against plus the option and event
// types it references. XmppConnection in connection.ts implements it;
// DemoConnection in demo.ts fakes it. connection.ts re-exports all of
// this so existing importers keep working.

import type { Emitter } from '$lib/core/events'

import type { PepPublishOptions } from './features/pep'
import type {
  Bookmark,
  ChatState,
  DiscoInfo,
  DiscoItem,
  IncomingMessage,
  MamPageResult,
  MarkerType,
  MucOccupant,
  PresenceUpdate,
  RosterItem,
  UploadSlot
} from './stanzas'

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'authfail' | 'error'

interface SubscriptionRequest {
  from: string
  status: string
}

// XEP-0461 reply target: id is the replied-to stanza id, plus its author
// jid. The author can be named to (wire attribute style) or from (the
// field name used by the parsed IncomingMessage replyTo shape).
type ReplyRef =
  { id: string; to: string } | { id: string; from: string; quote?: string | undefined }

export interface SendMessageOptions {
  replyTo?: ReplyRef | undefined
  // XEP-0308: id of the stanza this message corrects
  replaceId?: string | undefined
}

// XEP-0446 file metadata, all fields optional on the wire.
export interface AttachmentMeta {
  name?: string | undefined
  mediaType?: string | undefined
  size?: number | undefined
  duration?: number | undefined
}

export type ConnectionEvents = {
  status: ConnectionStatus
  message: IncomingMessage
  presence: PresenceUpdate
  roster: RosterItem[]
  rosterUpdate: RosterItem
  rosterRemove: string
  subscriptionRequest: SubscriptionRequest
  occupant: MucOccupant
  // XEP-0191 pushes: jids the server added to or removed from the
  // blocklist. An empty unblocked list means the list was cleared.
  blocked: string[]
  unblocked: string[]
  // XEP-0402 PEP notification: another of our resources published or
  // retracted bookmark items. Consumers refetch the node (last write
  // wins) rather than trusting the partial update.
  bookmarks: { updated: Bookmark[]; retracted: string[] }
}

// The transport surface the state layer depends on. XmppConnection is the
// real transport; DemoConnection in demo.ts is the fake one used by demo mode.
export interface ChatConnection {
  readonly events: Emitter<ConnectionEvents>
  readonly connected: boolean
  readonly jid: string
  connect(jid: string, password: string): void
  disconnect(): void
  uniqueId(prefix: string): string
  sendChatMessage(
    to: string,
    body: string,
    type?: 'chat' | 'groupchat',
    opts?: SendMessageOptions
  ): string
  sendReaction(to: string, targetId: string, emojis: string[], type?: 'chat' | 'groupchat'): void
  sendAttachment(
    to: string,
    url: string,
    type?: 'chat' | 'groupchat',
    meta?: AttachmentMeta
  ): string
  // Optional on the interface because demo mode has no upload service to
  // discover; requestUploadSlot covers the whole flow.
  discoverUploadService?(onDone: (serviceJid: string | null) => void): void
  requestUploadSlot(
    name: string,
    size: number,
    mediaType: string,
    onDone: (slot: UploadSlot | null) => void
  ): void
  uploadFile(
    putUrl: string,
    file: Blob,
    headers?: Record<string, string>,
    onProgress?: (fraction: number) => void
  ): Promise<void>
  sendChatState(to: string, state: ChatState, type?: 'chat' | 'groupchat'): void
  sendReceipt(to: string, id: string): void
  sendMarker(to: string, id: string, marker: MarkerType): void
  sendPresence(show?: string, status?: string): void
  sendDirectedPresence(to: string, type?: string, status?: string): void
  fetchAvatar(jid: string, onDone: (dataUri: string | undefined) => void): void
  fetchRoster(): void
  rosterSet(jid: string, name: string, groups?: string[]): void
  rosterRemove(jid: string): void
  // XEP-0191 blocklist. unblockJids with an empty list unblocks all.
  fetchBlocklist(onDone: (jids: string[]) => void): void
  blockJids(jids: string[]): void
  unblockJids(jids: string[]): void
  // PEP item fetch/publish for omemo device lists and bundles. pepGet
  // resolves with the <items> element of the result iq, or null on error.
  pepGet(node: string, jid: string | undefined, onDone: (items: Element | null) => void): void
  // options adds XEP-0060 publish-options so the node config is applied
  // atomically with the publish
  pepPublish(
    node: string,
    itemId: string,
    payloadXml: string,
    options?: PepPublishOptions,
    onDone?: (ok: boolean) => void
  ): void
  // OMEMO: send a pre-encrypted message stanza. encryptedXml is the
  // serialized <encrypted> element produced by the omemo service.
  sendEncryptedMessage(to: string, encryptedXml: string, opts?: SendMessageOptions): string
  joinRoom(room: string, nick: string, password?: string): void
  leaveRoom(room: string, nick: string): void
  setRoomSubject(room: string, subject: string): void
  queryArchive(
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void
  enableCarbons(): void
  // XEP-0030 service discovery. discoInfo resolves null on error or
  // timeout; a node of the form base#ver is served from the entity-caps
  // cache when the verification string was already resolved before.
  discoInfo(
    jid: string,
    node: string | undefined,
    onDone: (info: DiscoInfo | null) => void
  ): void
  discoItems(jid: string, onDone: (items: DiscoItem[] | null) => void): void
  // XEP-0402 bookmarks on our own PEP node. fetch resolves null when the
  // server lacks PEP; add republishes and remove retracts one item.
  fetchBookmarks(onDone: (bookmarks: Bookmark[] | null) => void): void
  addBookmark(bookmark: Bookmark, onDone?: (ok: boolean) => void): void
  removeBookmark(jid: string, onDone?: (ok: boolean) => void): void
}
