// Demo mode: a fake XmppConnection that emits believable traffic so the app
// can be tried without a server. Activated by logging in with the JID
// demo@badinage.local (any password) or the Try the demo button. Fixtures
// and scripted replies live in demo-data.ts.

import { Emitter } from '$lib/core/events'

import type {
  AttachmentMeta,
  Bookmark,
  ChatConnection,
  ConnectionEvents,
  DiscoInfo,
  DiscoItem,
  MamPageResult,
  PepPublishOptions,
  SendMessageOptions,
  UploadSlot
} from './connection'
import {
  DemoOmemoPeers,
  demoBookmarks,
  demoRosterItems,
  emitArchivePage,
  emitContactPresence,
  emitDmHistory,
  emitEncryptedReply,
  emitReactionEcho,
  emitReply,
  emitRoomHistory,
  emitSubscriptionAccept,
  emitTypingEcho,
  ROOM,
  ROOM_SUBJECT,
  roomOccupants,
  scheduleLiveEvents
} from './demo-data'
import { DISCO_FEATURES, DISCO_IDENTITY } from './features/disco'
import type { ChatState, MarkerType } from './stanzas'

const DEMO_CONNECT_DELAY_MS = 400
const DEMO_REPLY_DELAY_MS = 1200
const DEMO_REPLY_JITTER_MS = 2400
const DEMO_REACTION_ECHO_DELAY_MS = 800
const DEMO_TYPING_ECHO_DELAY_MS = 900
const DEMO_SUBSCRIPTION_ACCEPT_DELAY_MS = 1500
const DEMO_MAM_PAGE_DELAY_MS = 400

function demoReplyDelay(): number {
  return DEMO_REPLY_DELAY_MS + Math.random() * DEMO_REPLY_JITTER_MS
}

export class DemoConnection implements ChatConnection {
  readonly events = new Emitter<ConnectionEvents>()

  connected = false
  jid = ''
  private timers: ReturnType<typeof setTimeout>[] = []
  private replyTimer: ReturnType<typeof setTimeout> | null = null
  // peers that already got their one older history page
  private mamPaged = new Set<string>()
  // the demo blocklist lives in memory and echoes pushes like a real
  // server would so every connected "resource" stays in sync
  private blocklist = new Set<string>()
  // in-memory PEP bookmark node, seeded with a couple of entries; built
  // eagerly so the connect-time fetch already sees them
  private bookmarks = new Map<string, Bookmark>(demoBookmarks().map((b) => [b.jid, b]))
  private readonly omemoPeers = new DemoOmemoPeers()

  connect(jid: string, _password: string): void {
    this.jid = jid
    this.events.emit('status', 'connecting')
    this.timers.push(
      setTimeout(() => {
        this.connected = true
        this.events.emit('status', 'connected')
        // seed on the next macrotask so listeners bound in reaction to
        // the connected status attach first; a real transport gets this
        // ordering for free from network latency
        this.timers.push(setTimeout(() => this.seed(), 0))
      }, DEMO_CONNECT_DELAY_MS)
    )
  }

  disconnect(): void {
    for (const t of this.timers) clearTimeout(t)
    if (this.replyTimer) clearTimeout(this.replyTimer)
    this.connected = false
    this.events.emit('status', 'disconnected')
  }

  uniqueId(prefix: string): string {
    return `demo-${prefix}-${Math.random().toString(36).slice(2, 10)}`
  }

  sendChatMessage(
    to: string,
    body: string,
    type: 'chat' | 'groupchat' = 'chat',
    opts?: SendMessageOptions
  ): string {
    const id = this.uniqueId('msg')
    this.timers.push(setTimeout(() => this.simulateReply(to, type), demoReplyDelay()))
    void body
    void opts
    return id
  }

  sendReaction(
    to: string,
    targetId: string,
    emojis: string[],
    type: 'chat' | 'groupchat' = 'chat'
  ): void {
    this.timers.push(
      setTimeout(
        () =>
          emitReactionEcho(
            this.events,
            this.jid,
            to,
            type,
            targetId,
            emojis,
            this.uniqueId('react')
          ),
        DEMO_REACTION_ECHO_DELAY_MS
      )
    )
  }

  sendAttachment(
    to: string,
    url: string,
    type: 'chat' | 'groupchat' = 'chat',
    meta?: AttachmentMeta
  ): string {
    // pretend the file went out and let the peer respond as usual
    const id = this.uniqueId('att')
    this.timers.push(setTimeout(() => this.simulateReply(to, type), demoReplyDelay()))
    void url
    void meta
    return id
  }

  discoverUploadService(onDone: (serviceJid: string | null) => void): void {
    // pretend a service exists; slot requests still fall back to data uris
    onDone('upload.badinage.local')
  }

  requestUploadSlot(
    name: string,
    size: number,
    mediaType: string,
    onDone: (slot: UploadSlot | null) => void
  ): void {
    // never grant a slot so the ui exercises its data uri fallback
    void name
    void size
    void mediaType
    onDone(null)
  }

  uploadFile(
    putUrl: string,
    file: Blob,
    headers?: Record<string, string>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    // nothing is really uploaded; report completion anyway
    void putUrl
    void file
    void headers
    onProgress?.(1)
    return Promise.resolve()
  }

  pepGet(node: string, jid: string | undefined, onDone: (items: Element | null) => void): void {
    this.omemoPeers.get(node, jid, this.jid, onDone)
  }

  pepPublish(
    node: string,
    itemId: string,
    payloadXml: string,
    options?: PepPublishOptions,
    onDone?: (ok: boolean) => void
  ): void {
    void node
    void itemId
    void payloadXml
    void options
    onDone?.(true)
  }

  sendEncryptedMessage(to: string, encryptedXml: string, opts?: SendMessageOptions): string {
    void encryptedXml
    void opts
    const id = this.uniqueId('msg')
    this.timers.push(
      setTimeout(
        () => emitEncryptedReply(this.events, this.jid, to, this.uniqueId('reply')),
        demoReplyDelay()
      )
    )
    return id
  }

  sendChatState(to: string, state: ChatState, type: 'chat' | 'groupchat' = 'chat'): void {
    if (state !== 'composing' || type !== 'chat') return
    this.timers.push(
      setTimeout(() => emitTypingEcho(this.events, this.jid, to), DEMO_TYPING_ECHO_DELAY_MS)
    )
  }

  sendReceipt(to: string, id: string): void {
    void to
    void id
  }

  sendMarker(to: string, id: string, marker: MarkerType): void {
    void to
    void id
    void marker
  }

  sendPresence(): void {
    // demo presence is already seeded in connect()
  }

  sendDirectedPresence(to: string, type?: string): void {
    if (type === 'subscribe') {
      this.timers.push(
        setTimeout(() => emitSubscriptionAccept(this.events, to), DEMO_SUBSCRIPTION_ACCEPT_DELAY_MS)
      )
    }
  }

  fetchAvatar(jid: string, onDone: (dataUri: string | undefined) => void): void {
    // the lobby room gets the app mark as its avatar
    onDone(jid === ROOM ? '/icons/icon-192.png' : undefined)
  }

  fetchRoster(): void {
    this.events.emit('roster', demoRosterItems())
  }

  rosterSet(jid: string, name: string): void {
    this.events.emit('rosterUpdate', { jid, name, subscription: 'none', groups: [] })
  }

  rosterRemove(jid: string): void {
    this.events.emit('rosterRemove', jid)
  }

  fetchBlocklist(onDone: (jids: string[]) => void): void {
    onDone([...this.blocklist])
  }

  blockJids(jids: string[]): void {
    for (const jid of jids) this.blocklist.add(jid)
    this.events.emit('blocked', jids)
  }

  unblockJids(jids: string[]): void {
    if (jids.length === 0) this.blocklist.clear()
    for (const jid of jids) this.blocklist.delete(jid)
    this.events.emit('unblocked', jids)
  }

  joinRoom(room: string, nick: string): void {
    for (const occupant of roomOccupants(room, nick)) this.events.emit('occupant', occupant)
    this.events.emit('message', {
      from: room,
      to: this.jid,
      body: '',
      type: 'groupchat',
      subject: ROOM_SUBJECT
    })
  }

  leaveRoom(room: string, nick: string): void {
    this.events.emit('occupant', {
      room,
      nick,
      presence: 'offline',
      affiliation: 'member',
      role: 'none',
      self: true,
      codes: ['110']
    })
  }

  setRoomSubject(room: string, subject: string): void {
    void room
    void subject
  }

  queryArchive(
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void {
    void opts.max
    // calls without a before cursor are the initial pull; the seeded
    // history stands in for it, so hand back a cursor that lets scroll-up
    // fetch one more page
    if (opts.before === undefined) {
      onDone(
        this.mamPaged.has(peerJid)
          ? { complete: true }
          : { complete: false, first: `mam-page-${peerJid}-0` }
      )
      return
    }
    if (this.mamPaged.has(peerJid)) {
      onDone({ complete: true })
      return
    }
    this.mamPaged.add(peerJid)
    this.timers.push(
      setTimeout(() => {
        emitArchivePage(
          this.events,
          this.jid,
          peerJid,
          opts.room === true || peerJid.includes('@conference.')
        )
        onDone({ complete: true, first: `mam-page-${peerJid}-1` })
      }, DEMO_MAM_PAGE_DELAY_MS)
    )
  }

  enableCarbons(): void {
    // demo mode emits carbon-shaped history directly
  }

  discoInfo(
    jid: string,
    node: string | undefined,
    onDone: (info: DiscoInfo | null) => void
  ): void {
    // every demo peer pretends to be Badinage itself
    void jid
    void node
    onDone({ identities: [{ ...DISCO_IDENTITY }], features: [...DISCO_FEATURES], forms: [] })
  }

  discoItems(jid: string, onDone: (items: DiscoItem[] | null) => void): void {
    void jid
    onDone([
      { jid: 'conference.badinage.local', name: 'Chat rooms' },
      { jid: 'upload.badinage.local', name: 'File uploads' }
    ])
  }

  fetchBookmarks(onDone: (bookmarks: Bookmark[] | null) => void): void {
    // deferred like a real network round trip so listeners bound after
    // connect still observe the follow-up traffic
    this.timers.push(
      setTimeout(() => onDone([...this.bookmarks.values()]), DEMO_CONNECT_DELAY_MS)
    )
  }

  addBookmark(bookmark: Bookmark, onDone?: (ok: boolean) => void): void {
    this.bookmarks.set(bookmark.jid, bookmark)
    onDone?.(true)
  }

  removeBookmark(jid: string, onDone?: (ok: boolean) => void): void {
    this.bookmarks.delete(jid)
    onDone?.(true)
  }

  private seed(): void {
    this.fetchRoster()
    emitContactPresence(this.events)
    emitDmHistory(this.events, this.jid)
    this.joinRoom(ROOM, 'you')
    emitRoomHistory(this.events, this.jid)
    scheduleLiveEvents(
      this.events,
      this.jid,
      (prefix) => this.uniqueId(prefix),
      (fn, ms) => {
        this.timers.push(setTimeout(fn, ms))
      }
    )
  }

  private simulateReply(to: string, type: 'chat' | 'groupchat' = 'chat'): void {
    emitReply(this.events, this.jid, to, type, this.uniqueId('reply'))
  }
}
