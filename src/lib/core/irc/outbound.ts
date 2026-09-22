// Outbound commands: every send-side ChatConnection method as a free
// function over an IrcSend context, mirroring how core/xmpp/features
// programs against XmppTransport.

import type { ChatState, MarkerType } from '$lib/core/xmpp/stanzas'
import type {
  ChannelSearchItem,
  DataForm,
  DiscoInfo,
  DiscoItem,
  UploadSlot,
  Vcard
} from '$lib/core/xmpp/stanzas'
import type { SendMessageOptions, TransportCapabilities, VcardApi } from '$lib/core/xmpp/types'
import type { PepPublishOptions } from '$lib/core/xmpp/features/pep/pep'
import { bareJid } from '$lib/utils/jid'

import { jidToTarget, type ISupport } from './address'
import { ircEqual, serializeLine, splitMessage } from './line'

// client-only tag names. All require the message-tags capability
const TYPING_TAG = '+typing'
const REPLY_TAG = '+draft/reply'
const REACT_TAG = '+draft/react'
const UNREACT_TAG = '+draft/unreact'
const DELETE_TAG = '+draft/delete'
const EDIT_TAG = '+draft/edit'

// what the send functions need off the connection
export interface IrcSend {
  raw(line: string): void
  caps(): ReadonlySet<string>
  isupport: ISupport
  uniqueId(prefix: string): string
  noteLabel(label: string, peer: string): void
}

function hasTags(send: IrcSend): boolean {
  return send.caps().has('message-tags')
}

function tagged(
  send: IrcSend,
  command: string,
  target: string,
  text: string,
  tags: Record<string, string | undefined>,
  wireId?: string
): void {
  const merged = { ...tags }
  if (wireId && send.caps().has('labeled-response')) merged['label'] = wireId
  send.raw(serializeLine({ tags: merged, command, params: [target, text] }))
}

export function sendChatMessage(
  send: IrcSend,
  to: string,
  body: string,
  opts?: SendMessageOptions
): string {
  const id = send.uniqueId('m')
  const target = jidToTarget(to)
  send.noteLabel(id, bareJid(to))
  const tags: Record<string, string | undefined> = {}
  const reply = opts?.replyTo
  if (reply && hasTags(send)) tags[REPLY_TAG] = reply.id
  if (opts?.replaceId && hasTags(send)) tags[EDIT_TAG] = opts.replaceId
  // geoloc degrades to the geo: uri body the composer already produces.
  // spoilers and ephemeral timers have no IRC form and drop silently
  void opts?.geoloc
  const lines = body.split('\n')
  if (lines.length > 1 && send.caps().has('draft/multiline')) {
    const ref = send.uniqueId('b')
    send.raw(`BATCH +${ref} draft/multiline ${target}`)
    for (const line of lines) tagged(send, 'PRIVMSG', target, line, { ...tags, batch: ref }, id)
    send.raw(`BATCH -${ref}`)
    return id
  }
  for (const line of lines) {
    for (const chunk of splitMessage(line)) tagged(send, 'PRIVMSG', target, chunk, tags, id)
  }
  return id
}

// IRC reactions are per-emoji tag messages rather than a full set, so
// the connection diffs the desired set against what it last sent
export function sendReaction(
  send: IrcSend,
  reacted: Map<string, Set<string>>,
  to: string,
  targetId: string,
  emojis: string[]
): void {
  if (!hasTags(send)) return
  const target = jidToTarget(to)
  const key = `${target}:${targetId}`
  const previous = reacted.get(key) ?? new Set<string>()
  for (const emoji of emojis) {
    if (!previous.has(emoji)) {
      tagged(send, 'TAGMSG', target, '', { [REPLY_TAG]: targetId, [REACT_TAG]: emoji })
    }
  }
  for (const emoji of previous) {
    if (!emojis.includes(emoji)) {
      tagged(send, 'TAGMSG', target, '', { [REPLY_TAG]: targetId, [UNREACT_TAG]: emoji })
    }
  }
  reacted.set(key, new Set(emojis))
}

export function sendChatState(send: IrcSend, to: string, state: ChatState): void {
  if (!hasTags(send)) return
  const value = state === 'composing' ? 'active' : state === 'paused' ? 'paused' : 'done'
  tagged(send, 'TAGMSG', jidToTarget(to), '', { [TYPING_TAG]: value })
}

export function sendRetraction(send: IrcSend, to: string, targetId: string): void {
  if (!hasTags(send)) return
  tagged(send, 'TAGMSG', jidToTarget(to), '', { [DELETE_TAG]: targetId })
}

export function sendMarker(send: IrcSend, to: string, marker: MarkerType): void {
  if (marker !== 'displayed' || !send.caps().has('draft/read-marker')) return
  send.raw(`MARKREAD ${jidToTarget(to)} timestamp=${new Date().toISOString()}`)
}

export function joinRoom(
  send: IrcSend,
  ourNick: string,
  room: string,
  nick: string,
  key?: string
): void {
  // nick changes are global on IRC. A join under a different nick
  // renames first so the occupant events line up
  if (!ircEqual(nick, ourNick, send.isupport.casemapping)) send.raw(`NICK ${nick}`)
  send.raw(key ? `JOIN ${jidToTarget(room)} ${key}` : `JOIN ${jidToTarget(room)}`)
}

export function leaveRoom(send: IrcSend, room: string): void {
  send.raw(`PART ${jidToTarget(room)}`)
}

export function setRoomSubject(send: IrcSend, room: string, subject: string): void {
  send.raw(`TOPIC ${jidToTarget(room)} :${subject}`)
}

export function kickOccupant(send: IrcSend, room: string, nick: string, reason?: string): void {
  send.raw(`KICK ${jidToTarget(room)} ${nick}${reason ? ` :${reason}` : ''}`)
}

// the jid argument carries the occupant nick in its localpart. Ban a
// nick!*@* mask since real hostmasks are not always known
export function banOccupant(send: IrcSend, room: string, jid: string, _reason?: string): void {
  send.raw(`MODE ${jidToTarget(room)} +b ${jidToTarget(jid)}!*@*`)
}

export function inviteToRoom(send: IrcSend, room: string, to: string): void {
  send.raw(`INVITE ${jidToTarget(to)} ${jidToTarget(room)}`)
}

export function moderateMessage(send: IrcSend, room: string, stanzaId: string): void {
  if (!hasTags(send)) return
  tagged(send, 'TAGMSG', jidToTarget(room), '', { [DELETE_TAG]: stanzaId })
}

export function sendMarkread(send: IrcSend, peer: string): boolean {
  if (!send.caps().has('draft/read-marker')) return false
  send.raw(`MARKREAD ${jidToTarget(peer)} timestamp=${new Date().toISOString()}`)
  return true
}

export function sendPresence(send: IrcSend, show?: string, status?: string): void {
  // IRC presence is binary away. every non-online show maps to AWAY
  // with the status text as the away message
  if (show === undefined || show === 'online' || show === 'chat') {
    send.raw('AWAY')
  } else {
    send.raw(`AWAY :${status ?? show}`)
  }
}

export function setInvisible(send: IrcSend, nick: string, enabled: boolean): void {
  send.raw(`MODE ${nick} ${enabled ? '+' : '-'}i`)
}

export function monitor(send: IrcSend, add: string[], remove: string[]): void {
  if (add.length > 0) send.raw(`MONITOR + ${add.join(',')}`)
  if (remove.length > 0) send.raw(`MONITOR - ${remove.join(',')}`)
}

export function queryArchive(
  send: IrcSend,
  target: string,
  before: string | undefined,
  limit: number
): void {
  const name = jidToTarget(target)
  send.raw(
    before === undefined
      ? `CHATHISTORY LATEST ${name} * ${limit}`
      : `CHATHISTORY BEFORE ${name} msgid=${before} ${limit}`
  )
}

const noop = (): void => undefined

// Everything ChatConnection demands that IRC cannot express. These
// are honest no-ops: callers are meant to gate on capabilities first,
// so reaching one is a state-layer bug rather than a user failure.
export abstract class IrcStubs {
  readonly capabilities: TransportCapabilities = {
    e2ee: false,
    upload: false,
    roster: true,
    subscriptions: false,
    profile: false,
    roomConfig: false,
    registration: false
  }
  readonly vcard: VcardApi = {
    fetch: (onDone) => onDone(null),
    fetchPeer: (_jid, onDone) => onDone(null),
    set: (_vcard: Vcard, onDone) => onDone(true)
  }
  private idCounter = 0

  uniqueId(prefix: string): string {
    return `irc-${prefix}-${++this.idCounter}-${Math.random().toString(36).slice(2, 8)}`
  }

  fetchAvatar(_jid: string, onDone: (dataUri: string | undefined) => void): void {
    onDone(undefined)
  }
  requestUploadSlot(
    _n: string,
    _s: number,
    _m: string,
    onDone: (slot: UploadSlot | null) => void
  ): void {
    onDone(null)
  }
  uploadFile(): Promise<void> {
    return Promise.resolve()
  }
  sendAttachment(): string {
    return this.uniqueId('att')
  }
  sendReceipt = noop
  sendAttention = noop
  sendRtt = noop
  sendEncryptedMessage(): string {
    return this.uniqueId('enc')
  }
  sendEncryptedNotification = noop
  sendTrustMessage = noop
  sendDirectedPresence = noop
  declineRoomInvite = noop
  grantMembership = noop
  pepGet(_n: string, _j: string | undefined, onDone: (items: Element | null) => void): void {
    onDone(null)
  }
  pepPublish(
    _n: string,
    _i: string,
    _x: string,
    _o?: PepPublishOptions,
    onDone?: (ok: boolean) => void
  ): void {
    onDone?.(false)
  }
  enableCarbons = noop
  setClientActive = noop
  streamManagementEnabled(): boolean {
    return false
  }
  sessionResumed(): boolean {
    return false
  }
  discoInfo(_j: string, _n: string | undefined, onDone: (info: DiscoInfo | null) => void): void {
    onDone(null)
  }
  discoItems(_j: string, onDone: (items: DiscoItem[] | null) => void): void {
    onDone([])
  }
  channelSearchForm(_s: string, onDone: (form: DataForm | null) => void): void {
    onDone(null)
  }
  channelSearch(_s: string, _f: DataForm, cb: (items: ChannelSearchItem[] | null) => void): void {
    cb([])
  }
  fetchRoomConfig(_r: string, onDone: (form: DataForm | null) => void): void {
    onDone(null)
  }
  submitRoomConfig = noop
  rttSupported(_j: string, onDone: (supported: boolean) => void): void {
    onDone(false)
  }
}
