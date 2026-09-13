// Transport layer: owns the Strophe connection, reconnect backoff, and the
// event surface the rest of the app consumes. The public contract lives in
// types.ts (re-exported below), stanza parsing in stanzas.ts, and the wire
// flows in the feature modules under features/. Keep protocol knowledge
// out of this file.

import { $iq, Strophe } from 'strophe.js'

import { RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS } from '$lib/constants'
import { Emitter } from '$lib/core/events'

import { blockJids, fetchBlocklist, unblockJids } from './features/blocking'
import {
  handleBlockPush,
  handleMessage,
  handlePresence,
  handleRosterPush
} from './features/handlers'
import { queryArchive } from './features/mam'
import {
  sendAttachment,
  sendChatMessage,
  sendChatState,
  sendMarker,
  sendReaction,
  sendReceipt
} from './features/messaging'
import { joinRoom, leaveRoom, setRoomSubject } from './features/muc'
import { pepGet, pepPublish, sendEncryptedMessage } from './features/pep'
import { fetchAvatar, sendDirectedPresence, sendPresence } from './features/presence'
import { fetchRoster, rosterRemove, rosterSet } from './features/roster'
import { noop, type StanzaBuilder, type XmppTransport } from './features/transport'
import { discoverUploadService, requestUploadSlot, uploadFile } from './features/upload'
import { NS } from './ns'
import type { ChatState, MamPageResult, MarkerType, UploadSlot } from './stanzas'
import type { AttachmentMeta, ChatConnection, ConnectionEvents, SendMessageOptions } from './types'

// The public contract lives in types.ts and the parsed result shapes in
// stanzas.ts; re-exported here so importers of this module keep working.
export type { MamPageResult, UploadSlot } from './stanzas'
export type {
  AttachmentMeta,
  ChatConnection,
  ConnectionEvents,
  ConnectionStatus,
  SendMessageOptions
} from './types'

type StropheConnection = InstanceType<typeof Strophe.Connection>

export class XmppConnection implements ChatConnection {
  readonly events = new Emitter<ConnectionEvents>()

  private conn: StropheConnection
  private readonly transport: XmppTransport
  private reconnectDelay = RECONNECT_DELAY_MS
  private manualDisconnect = false

  constructor(
    private readonly service: string,
    conn?: StropheConnection
  ) {
    this.conn = conn ?? new Strophe.Connection(service)
    conn = this.conn
    this.transport = {
      sendIq: (stanza, onResult, onError) => this.sendIq(stanza, onResult, onError),
      send: (stanza) => conn.send(stanza),
      uniqueId: (prefix) => conn.getUniqueId(prefix),
      get jid() {
        return conn.jid ?? ''
      }
    }
  }

  get connected(): boolean {
    return this.conn.connected
  }

  get jid(): string {
    return this.conn.jid ?? ''
  }

  connect(jid: string, password: string): void {
    this.manualDisconnect = false
    this.conn.connect(jid, password, (status) => this.onStatus(status))
  }

  disconnect(): void {
    this.manualDisconnect = true
    this.conn.disconnect()
  }

  uniqueId(prefix: string): string {
    return this.conn.getUniqueId(prefix)
  }

  sendIq(
    stanza: StanzaBuilder,
    onResult: (stanza: Element) => void,
    onError?: (stanza: Element | null) => void
  ): void {
    this.conn.sendIQ(stanza, onResult, onError ?? noop)
  }

  // ---- messaging, implemented in features/messaging.ts ---------------------

  sendChatMessage(
    to: string,
    body: string,
    type: 'chat' | 'groupchat' = 'chat',
    opts?: SendMessageOptions
  ): string {
    return sendChatMessage(this.transport, to, body, type, opts)
  }

  sendReaction(
    to: string,
    targetId: string,
    emojis: string[],
    type: 'chat' | 'groupchat' = 'chat'
  ): void {
    sendReaction(this.transport, to, targetId, emojis, type)
  }

  sendAttachment(
    to: string,
    url: string,
    type: 'chat' | 'groupchat' = 'chat',
    meta?: AttachmentMeta
  ): string {
    return sendAttachment(this.transport, to, url, type, meta)
  }

  sendChatState(to: string, state: ChatState, type: 'chat' | 'groupchat' = 'chat'): void {
    sendChatState(this.transport, to, state, type)
  }

  sendReceipt(to: string, id: string): void {
    sendReceipt(this.transport, to, id)
  }

  sendMarker(to: string, id: string, marker: MarkerType): void {
    sendMarker(this.transport, to, id, marker)
  }

  // ---- HTTP upload, implemented in features/upload.ts -----------------------

  discoverUploadService(onDone: (serviceJid: string | null) => void): void {
    discoverUploadService(this.transport, onDone)
  }

  requestUploadSlot(
    name: string,
    size: number,
    mediaType: string,
    onDone: (slot: UploadSlot | null) => void
  ): void {
    requestUploadSlot(this.transport, name, size, mediaType, onDone)
  }

  uploadFile(
    putUrl: string,
    file: Blob,
    headers?: Record<string, string>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    return uploadFile(putUrl, file, headers, onProgress)
  }

  // ---- PEP / OMEMO, implemented in features/pep.ts ---------------------------

  pepGet(node: string, jid: string | undefined, onDone: (items: Element | null) => void): void {
    pepGet(this.transport, node, jid, onDone)
  }

  pepPublish(node: string, itemId: string, payloadXml: string): void {
    pepPublish(this.transport, node, itemId, payloadXml)
  }

  sendEncryptedMessage(to: string, encryptedXml: string, opts?: SendMessageOptions): string {
    return sendEncryptedMessage(this.transport, to, encryptedXml, opts)
  }

  // ---- presence / avatars, implemented in features/presence.ts ----------------

  sendPresence(show?: string, status?: string): void {
    sendPresence(this.transport, show, status)
  }

  sendDirectedPresence(to: string, type?: string, status?: string): void {
    sendDirectedPresence(this.transport, to, type, status)
  }

  fetchAvatar(jid: string, onDone: (dataUri: string | undefined) => void): void {
    fetchAvatar(this.transport, jid, onDone)
  }

  // ---- roster, implemented in features/roster.ts ------------------------------

  fetchRoster(): void {
    fetchRoster(this.transport, (items) => this.events.emit('roster', items))
  }

  rosterSet(jid: string, name: string, groups: string[] = []): void {
    rosterSet(this.transport, jid, name, groups)
  }

  rosterRemove(jid: string): void {
    rosterRemove(this.transport, jid)
  }

  // ---- blocking (XEP-0191), implemented in features/blocking.ts ----------------

  fetchBlocklist(onDone: (jids: string[]) => void): void {
    fetchBlocklist(this.transport, onDone)
  }

  blockJids(jids: string[]): void {
    blockJids(this.transport, jids)
  }

  unblockJids(jids: string[]): void {
    unblockJids(this.transport, jids)
  }

  // ---- MUC, implemented in features/muc.ts -------------------------------------

  joinRoom(room: string, nick: string, password?: string): void {
    joinRoom(this.transport, room, nick, password)
  }

  leaveRoom(room: string, nick: string): void {
    leaveRoom(this.transport, room, nick)
  }

  setRoomSubject(room: string, subject: string): void {
    setRoomSubject(this.transport, room, subject)
  }

  // ---- MAM, implemented in features/mam.ts ---------------------------------------

  // Results arrive as 'message' events flagged with mam=true; onDone
  // fires when the iq result (fin) arrives.
  queryArchive(
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void {
    queryArchive(this.transport, peerJid, opts, onDone)
  }

  enableCarbons(): void {
    this.sendIq(
      $iq({ type: 'set', id: this.conn.getUniqueId('carbons') }).c('enable', {
        xmlns: NS.CARBONS
      }),
      noop
    )
  }

  // ---- internals -----------------------------------------------------------------

  private onStatus(status: number): void {
    switch (status) {
      case Strophe.Status.CONNECTING:
      case Strophe.Status.AUTHENTICATING:
        this.events.emit('status', 'connecting')
        break
      case Strophe.Status.CONNECTED:
      case Strophe.Status.ATTACHED:
        this.reconnectDelay = RECONNECT_DELAY_MS
        this.onConnected()
        this.events.emit('status', 'connected')
        break
      case Strophe.Status.DISCONNECTING:
        this.events.emit('status', 'disconnecting')
        break
      case Strophe.Status.AUTHFAIL:
        this.events.emit('status', 'authfail')
        break
      case Strophe.Status.ERROR:
      case Strophe.Status.CONNTIMEOUT:
      case Strophe.Status.CONNFAIL:
        this.events.emit('status', 'error')
        break
      case Strophe.Status.DISCONNECTED:
        this.events.emit('status', 'disconnected')
        if (!this.manualDisconnect) this.scheduleReconnect()
        break
    }
  }

  private onConnected(): void {
    this.conn.addHandler((stanza) => handleMessage(stanza, this.events), null, 'message', null)
    this.conn.addHandler(
      (stanza) => handlePresence(stanza, this.events, this.transport),
      null,
      'presence',
      null
    )
    this.conn.addHandler(
      (stanza) => handleRosterPush(stanza, this.events, this.transport),
      NS.ROSTER,
      'iq',
      'set'
    )
    this.conn.addHandler(
      (stanza) => handleBlockPush(stanza, this.events, this.transport),
      NS.BLOCKING,
      'iq',
      'set'
    )
    this.enableCarbons()
    this.sendPresence()
    this.fetchRoster()
  }

  private scheduleReconnect(): void {
    const { jid, pass } = this.conn
    if (!jid || typeof pass !== 'string' || !pass) return
    setTimeout(() => {
      if (!this.manualDisconnect && !this.conn.connected) {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_DELAY_MAX_MS)
        this.connect(jid, pass)
      }
    }, this.reconnectDelay)
  }
}
