// IRC transport: a ChatConnection over a WebSocket to an IRCv3 server.
// Thin adapter: the socket lives in transport.ts, wire commands in
// outbound.ts, dispatch in inbound.ts + occupants.ts + mapping.ts,
// lists in account-lists.ts, jid bridging in address.ts.

import { Emitter } from '$lib/core/events'
import { CHANNEL_SEARCH_FEATURE } from '$lib/core/xmpp/features/search'
import type {
  Bookmark,
  ChannelSearchItem,
  ChatState,
  DataForm,
  DiscoInfo,
  DiscoItem,
  MamPageResult,
  MarkerType
} from '$lib/core/xmpp/stanzas'
import type { ChatConnection, ConnectionEvents, SendMessageOptions } from '$lib/core/xmpp/types'
import { bareJid } from '$lib/utils/jid'

import { AccountLists, HistoryQueue } from './account-lists'
import { defaultISupport, jidToTarget, parseIsupport, targetToJid } from './address'
import { Inbound } from './inbound'
import { ircLower } from './line'
import type { IrcView } from './mapping'
import { Membership } from './occupants'
import { SessionState } from './session'
import {
  banOccupant,
  inviteToRoom,
  joinRoom,
  kickOccupant,
  leaveRoom,
  moderateMessage,
  monitor,
  IrcStubs,
  queryArchive,
  sendChatMessage,
  sendChatState,
  sendMarker,
  sendMarkread,
  sendPresence,
  sendReaction,
  sendRetraction,
  setInvisible,
  setRoomSubject,
  type IrcSend
} from './outbound'
import { IrcLink } from './transport'

export class IrcConnection extends IrcStubs implements ChatConnection, IrcSend, IrcView {
  readonly events = new Emitter<ConnectionEvents>()

  readonly isupport = defaultISupport()
  private readonly link: IrcLink
  private readonly lists: AccountLists
  private readonly history: HistoryQueue
  private readonly membership = new Membership(() => this.isupport.casemapping)
  private readonly inbound: Inbound
  private readonly state = new SessionState()
  accountBare = ''
  ourNick = ''

  constructor(
    private readonly service: string,
    readonly domain: string,
    options?: { persist?: boolean | undefined }
  ) {
    super()
    this.lists = new AccountLists(options?.persist ?? true, domain, this.isupport, {
      rosterUpdate: (item) => this.events.emit('rosterUpdate', item),
      rosterRemove: (jid) => this.events.emit('rosterRemove', jid),
      blocked: (jids) => this.events.emit('blocked', jids),
      unblocked: (jids) => this.events.emit('unblocked', jids)
    })
    this.link = new IrcLink(service, {
      onLine: (line) => this.inbound.handle(line),
      onRegistered: (nick) => this.onRegistered(nick),
      onStatus: (status) => this.onLinkStatus(status),
      onIsupport: (params) => parseIsupport(this.isupport, params),
      onLatency: (ms) => this.events.emit('latency', ms)
    })
    this.history = new HistoryQueue(
      () => this.connected && this.caps().has('draft/chathistory'),
      (query) => {
        this.inbound.noteHistory(query.limit)
        queryArchive(this, query.target, query.before, query.limit)
      }
    )
    this.inbound = new Inbound({
      view: this,
      hooks: {
        message: (m) => this.events.emit('message', m),
        occupant: (o) => this.events.emit('occupant', o),
        presence: (p) => this.events.emit('presence', p),
        presenceError: (e) => this.events.emit('presenceError', e),
        invite: (i) => this.events.emit('roomInvite', i),
        readMarker: (peer, timestamp) => this.events.emit('readMarker', { peer, timestamp }),
        historyDone: (result) => this.history.finish(result)
      },
      addMember: (c, n) => this.membership.add(c, n),
      dropMember: (c, n) => this.membership.remove(c, n),
      channelsWith: (n) => this.membership.channelsWith(n),
      renameMember: (o, n) => this.membership.rename(o, n),
      noteNick: (n) => void (this.ourNick = n),
      monitored: (n) => this.lists.hasMonitored(n),
      renameMonitored: (o, n) => {
        const added = this.lists.renameMonitored(o, n)
        if (added) monitor(this, [added], [o])
      },
      blocked: (n) => this.lists.isBlocked(n),
      failLabel: (label, text, condition) =>
        this.state.failLabel(
          label,
          text,
          this.accountBare,
          (m) => this.events.emit('message', m),
          condition
        )
    })
  }

  // IrcView
  batchType(ref: string): string | undefined {
    return this.inbound.batchType(ref)
  }

  // IrcSend
  raw(line: string): void {
    this.link.send(line)
  }

  caps(): ReadonlySet<string> {
    return this.link.caps()
  }

  noteLabel(label: string, peer: string): void {
    this.state.noteLabel(label, peer)
  }

  get connected(): boolean {
    return this.link.connected
  }

  get jid(): string {
    return `${this.ourNick}@${this.domain}`
  }

  connect(jid: string, password: string): void {
    this.accountBare = bareJid(jid)
    this.ourNick = jidToTarget(this.accountBare)
    this.lists.load(this.accountBare)
    this.events.emit('status', 'connecting')
    this.link.connect(this.ourNick, password)
  }

  disconnect(): void {
    this.link.disconnect()
  }

  private onRegistered(nick: string): void {
    this.ourNick = nick
    this.events.emit('status', 'connected')
    for (const channel of new Set([...this.lists.autojoinChannels(), ...this.state.channels])) {
      this.state.channels.add(ircLower(channel, this.isupport.casemapping))
      this.raw(`JOIN ${channel}`)
    }
    this.lists.pushMonitor(this)
    this.events.emit('roster', this.lists.rosterItems())
  }

  private onLinkStatus(status: 'authfail' | 'error' | 'disconnected'): void {
    if (status === 'disconnected') {
      this.membership.clear()
      this.state.clear()
      this.history.reset()
    }
    this.events.emit('status', status)
  }

  sendChatMessage = (to: string, body: string, _t?: 'chat' | 'groupchat', o?: SendMessageOptions) =>
    sendChatMessage(this, to, body, o)

  sendReaction = (to: string, targetId: string, emojis: string[]): void =>
    sendReaction(this, this.state.reacted, to, targetId, emojis)

  sendChatState = (to: string, state: ChatState): void => sendChatState(this, to, state)

  sendRetraction = (to: string, targetId: string): void => sendRetraction(this, to, targetId)

  sendMarker = (to: string, _id: string, marker: MarkerType): void => sendMarker(this, to, marker)

  publishDisplayed = (peer: string, _id: string, _by?: string, onDone?: (ok: boolean) => void) =>
    onDone?.(sendMarkread(this, peer))

  joinRoom(room: string, nick: string, password?: string): void {
    this.state.channels.add(ircLower(jidToTarget(room), this.isupport.casemapping))
    joinRoom(this, this.ourNick, room, nick, password)
  }

  leaveRoom(room: string, _nick: string): void {
    this.state.channels.delete(ircLower(jidToTarget(room), this.isupport.casemapping))
    leaveRoom(this, room)
  }

  setRoomSubject = (room: string, subject: string): void => setRoomSubject(this, room, subject)

  changeRoomNick = (_room: string, _old: string, newNick: string): void =>
    this.raw(`NICK ${newNick}`)

  inviteToRoom = (room: string, to: string): void => inviteToRoom(this, room, to)

  kickOccupant = (room: string, nick: string, reason?: string): void =>
    kickOccupant(this, room, nick, reason)

  banOccupant = (room: string, jid: string, reason?: string): void =>
    banOccupant(this, room, jid, reason)

  moderateMessage = (room: string, stanzaId: string): void => moderateMessage(this, room, stanzaId)

  pingOccupant = (room: string, nick: string, onDone: (alive: boolean) => void): void =>
    onDone(this.connected && this.membership.has(jidToTarget(room), nick))

  fetchRoster = (): void => this.events.emit('roster', this.lists.rosterItems())

  rosterSet = (jid: string, name: string): void => this.lists.setContact(this, jid, name)

  rosterRemove = (jid: string): void => this.lists.dropContact(this, jid)

  fetchBlocklist = (onDone: (jids: string[]) => void): void => onDone(this.lists.blockedJids())

  blockJids = (jids: string[]): void => this.lists.blockJids(jids)

  unblockJids = (jids: string[]): void => this.lists.unblockJids(jids)

  fetchBookmarks = (onDone: (bookmarks: Bookmark[] | null) => void): void =>
    onDone(this.lists.bookmarks())

  addBookmark = (bookmark: Bookmark, onDone?: (ok: boolean) => void): void => {
    this.lists.addBookmark(this, bookmark, this.connected)
    onDone?.(true)
  }

  removeBookmark = (jid: string, onDone?: (ok: boolean) => void): void => {
    this.lists.removeAutojoin(jid)
    onDone?.(true)
  }

  queryArchive = (
    peerJid: string,
    opts: { max?: number; before?: string | undefined; room?: boolean | undefined },
    onDone: (result: MamPageResult) => void
  ): void => this.history.enqueue(peerJid, opts.before, opts.max, onDone)

  sendPresence = (show?: string, status?: string): void => sendPresence(this, show, status)

  setInvisible = (enabled: boolean, onDone: (ok: boolean) => void): void => {
    setInvisible(this, this.ourNick, enabled)
    onDone(true)
  }

  // discovery for the explore dialog: the account domain itself poses
  // as the one search service, backed by LIST
  discoItems = (jid: string, onDone: (items: DiscoItem[] | null) => void) =>
    onDone(bareJid(jid) === this.domain ? [{ jid: this.domain }] : [])

  discoInfo = (jid: string, _node: string | undefined, onDone: (info: DiscoInfo | null) => void) =>
    onDone(
      bareJid(jid) === this.domain
        ? { identities: [], features: [CHANNEL_SEARCH_FEATURE], forms: [] }
        : null
    )

  channelSearch = (
    _service: string,
    form: DataForm,
    onDone: (items: ChannelSearchItem[] | null) => void
  ): void => {
    const q = form.fields
      .find((field) => field.var === 'q')
      ?.values[0]?.trim()
      .replace(/[*?\s]+/g, '')
    const mask = q ? `*${q}*` : undefined
    const ok = this.link.listChannels(mask, (items) =>
      onDone(
        items?.map((item) => ({
          address: targetToJid(item.channel, this.domain, this.isupport),
          name: item.channel,
          ...(item.topic ? { description: item.topic } : {}),
          nusers: item.users
        })) ?? null
      )
    )
    if (!ok) onDone(null)
  }
}
