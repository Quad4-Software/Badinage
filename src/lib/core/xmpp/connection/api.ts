// Wire-level surface of XmppConnection: thin delegates that hand work to
// the feature modules under features/. Lives apart from index.ts (which
// owns the transport lifecycle) so neither file turns into a god file.
// The shared stream state below is written by the subclass internals.

import type { Strophe } from 'strophe.js'

import type { Emitter } from '$lib/core/events'
import type { RttEvent, RttOp } from '$lib/utils/protocol/rtt'

import { fetchAvatar } from '../features/pep/avatars'
import { blockJids, fetchBlocklist, unblockJids } from '../features/blocking'
import {
  sendAttachment,
  sendAttention,
  sendChatMessage,
  sendChatState,
  sendMarker,
  sendReaction,
  sendReceipt,
  sendRetraction,
  sendRtt,
  sendTrustMessage
} from '../features/messaging'
import {
  banOccupant,
  changeRoomNick,
  fetchRoomConfig,
  grantMembership,
  inviteToRoom,
  joinRoom,
  kickOccupant,
  leaveRoom,
  moderateMessage,
  pingOccupant,
  sendRoomDecline,
  setRoomSubject,
  submitRoomConfig
} from '../features/muc'
import {
  pepGet,
  pepPublish,
  sendEncryptedMessage,
  sendEncryptedNotification,
  type PepPublishOptions
} from '../features/pep/pep'
import { sendDirectedPresence, sendPresence } from '../features/presence'
import { fetchRoster, rosterRemove, rosterSet } from '../features/roster'
import { noop, type StanzaBuilder, type XmppTransport } from '../features/transport'
import { discoverUploadService, requestUploadSlot, uploadFile } from '../features/upload'

import type { ChatState, DataForm, MarkerType, TrustOwner, UploadSlot } from '../stanzas'
import type { AttachmentMeta, ChatKind, ConnectionEvents, SendMessageOptions } from '../types'

type StropheConnection = InstanceType<typeof Strophe.Connection>

export abstract class XmppConnectionApi {
  abstract readonly events: Emitter<ConnectionEvents>
  // assigned by the subclass constructor, before any delegate can run
  protected conn!: StropheConnection
  protected transport!: XmppTransport
  // namespaces advertised in stream:features, captured on connect.
  // Nonzas a server does not know are fatal on strict stacks, so carbons
  // and csi only go out when the stream advertised them
  protected streamFeatures = new Set<string>()
  // in-flight MAM queryids: only these result wrappers (or our own) unwrap
  protected readonly mamQueries = new Set<string>()
  // XEP-0352 desired and last-sent client state. Null means the ui never
  // told us, so nothing is sent
  protected csiActive: boolean | null = null
  protected csiSent: boolean | null = null

  uniqueId(prefix: string): string {
    return this.conn.getUniqueId(prefix)
  }

  sendIq(
    stanza: StanzaBuilder,
    onResult: (stanza: Element) => void,
    onError?: (stanza: Element | null) => void
  ): void {
    if (!this.conn.connected) {
      // queued iq work (omemo publish, disco) can race a teardown. Report
      // it as a failed send instead of throwing on a dead transport
      const fail = onError ?? noop
      fail(null)
      return
    }
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

  sendReaction(to: string, targetId: string, emojis: string[], type: ChatKind = 'chat'): void {
    sendReaction(this.transport, to, targetId, emojis, type)
  }

  sendAttachment(to: string, url: string, type: ChatKind = 'chat', meta?: AttachmentMeta): string {
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

  sendRetraction(to: string, targetId: string, type: 'chat' | 'groupchat' = 'chat'): void {
    sendRetraction(this.transport, to, targetId, type)
  }

  sendAttention(to: string, type: 'chat' | 'groupchat' = 'chat'): void {
    sendAttention(this.transport, to, type)
  }

  sendRtt(to: string, seq: number, event: RttEvent, ops: RttOp[]): void {
    sendRtt(this.transport, to, seq, event, ops)
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
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return uploadFile(putUrl, file, headers, onProgress, signal)
  }

  // ---- PEP / OMEMO, implemented in features/pep/pep.ts ---------------------------

  pepGet(node: string, jid: string | undefined, onDone: (items: Element | null) => void): void {
    pepGet(this.transport, node, jid, onDone)
  }

  pepPublish(
    node: string,
    itemId: string,
    payloadXml: string,
    options?: PepPublishOptions,
    onDone?: (ok: boolean) => void
  ): void {
    pepPublish(this.transport, node, itemId, payloadXml, options, onDone)
  }

  sendEncryptedMessage(to: string, encryptedXml: string, type?: 'chat' | 'groupchat'): string {
    return sendEncryptedMessage(this.transport, to, encryptedXml, type)
  }

  sendEncryptedNotification(to: string, encryptedXml: string): void {
    sendEncryptedNotification(this.transport, to, encryptedXml)
  }

  sendTrustMessage(to: string, usage: string, owners: TrustOwner[]): void {
    sendTrustMessage(this.transport, to, usage, owners)
  }

  // ---- presence / avatars / vcard, in features/presence.ts and features/pep/ ---

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

  changeRoomNick(room: string, oldNick: string, newNick: string, password?: string): void {
    changeRoomNick(this.transport, room, oldNick, newNick, password)
  }

  inviteToRoom(room: string, to: string, opts?: { reason?: string; password?: string }): void {
    inviteToRoom(this.transport, room, to, opts)
  }

  declineRoomInvite(room: string, to: string, reason?: string): void {
    sendRoomDecline(this.transport, room, to, reason)
  }

  grantMembership(room: string, jid: string): void {
    grantMembership(this.transport, room, jid)
  }

  kickOccupant(room: string, nick: string, reason?: string): void {
    kickOccupant(this.transport, room, nick, reason)
  }

  banOccupant(room: string, jid: string, reason?: string): void {
    banOccupant(this.transport, room, jid, reason)
  }

  moderateMessage(room: string, stanzaId: string, reason?: string): void {
    moderateMessage(this.transport, room, stanzaId, reason)
  }

  fetchRoomConfig(room: string, onDone: (form: DataForm | null) => void): void {
    fetchRoomConfig(this.transport, room, onDone)
  }

  submitRoomConfig(room: string, form: DataForm): void {
    submitRoomConfig(this.transport, room, form)
  }

  pingOccupant(room: string, nick: string, onDone: (alive: boolean) => void): void {
    pingOccupant(this.transport, room, nick, onDone)
  }
}
