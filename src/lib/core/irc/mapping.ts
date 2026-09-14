// Wire-to-event mapping: turns parsed IRC lines into the typed events
// ChatConnection emits. Pure functions over an IrcView so they unit
// test without sockets. The dispatcher lives in inbound.ts.

import type { ChatState } from '$lib/core/xmpp/stanzas'
import type { IncomingMessage, MucOccupant, PresenceUpdate } from '$lib/core/xmpp/stanzas'

import { isChannelTarget, targetToJid, type ISupport } from './address'
import { ctcpAction, ircEqual, prefixNick, stripMirc, type IrcLine } from './line'

// the view of connection state the mappers need. Kept minimal so tests
// can fake it.
export interface IrcView {
  domain: string
  isupport: ISupport
  // our current nick (post any rename), used for self checks
  ourNick: string
  // the stable login identity (loginnick@domain). Outgoing echoes are
  // always rewritten to it so ChatStore routes them as ours even after
  // a forced nick change
  accountBare: string
  // batch ref -> batch type ('chathistory', 'draft/multiline', ...)
  batchType(ref: string): string | undefined
}

function viewJid(view: IrcView, target: string): string {
  return targetToJid(target, view.domain, view.isupport)
}

export function senderNick(line: IrcLine): string {
  return prefixNick(line.prefix)
}

export function isSelf(view: IrcView, nick: string): boolean {
  return ircEqual(nick, view.ourNick, view.isupport.casemapping)
}

// bare jid of the user who sent this line, folded to our account
// identity when the sender is us
export function senderJid(view: IrcView, line: IrcLine): string {
  const nick = senderNick(line)
  return isSelf(view, nick) ? view.accountBare : viewJid(view, nick)
}

function timeTag(line: IrcLine): number | undefined {
  const raw = line.tags['time']
  if (!raw) return undefined
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : undefined
}

// inside a chathistory batch a line is archive traffic
function isMam(view: IrcView, line: IrcLine): boolean {
  const ref = line.tags['batch']
  return ref !== undefined && view.batchType(ref) === 'chathistory'
}

function chatStateOf(tag: string | undefined): ChatState | undefined {
  switch (tag) {
    case 'active':
      return 'composing'
    case 'paused':
      return 'paused'
    case 'done':
      return 'active'
    default:
      return undefined
  }
}

// PRIVMSG -> IncomingMessage. target is the channel or nick addressed.
export function mapPrivmsg(view: IrcView, line: IrcLine): IncomingMessage | null {
  const target = line.params[0]
  const nick = senderNick(line)
  if (!target || !nick) return null
  const channel = isChannelTarget(target, view.isupport)
  const action = ctcpAction(line.text)
  // CTCP ACTION maps to the app's literal /me convention so the
  // renderer shows it like the XMPP form
  const body = action !== null ? `/me ${stripMirc(action)}` : stripMirc(line.text)
  const self = isSelf(view, nick)
  const message: IncomingMessage = channel
    ? {
        from: `${viewJid(view, target)}/${nick}`,
        to: viewJid(view, target),
        body,
        type: 'groupchat',
        nick
      }
    : {
        from: self ? view.accountBare : viewJid(view, nick),
        to: self ? viewJid(view, target) : view.accountBare,
        body,
        type: 'chat'
      }
  const msgid = line.tags['msgid']
  if (msgid) {
    message.stanzaId = msgid
    message.stanzaBy = view.domain
  }
  const time = timeTag(line)
  if (time !== undefined) message.delay = time
  if (isMam(view, line)) message.mam = true
  // echo-message: our own dm traffic comes back from the server. Fold
  // to the account identity and mark it a sent-carbon so the store
  // renders it as delivered. Groupchat echoes intentionally carry no
  // carbon: the muc self-echo merge keys on nick instead
  if (self && !channel && !isMam(view, line)) message.carbon = 'sent'
  // labeled-response puts our send id on the echo. Adopting it as the
  // stanza id lets dedup merge the echo into the locally pushed copy
  const label = line.tags['label']
  if (self && label) message.id = label
  const account = line.tags['account']
  if (account && account !== '*') message.occupantId = account
  const reply = line.tags['+draft/reply'] ?? line.tags['+reply']
  if (reply) message.replyTo = { id: reply, from: senderJid(view, line) }
  const edit = line.tags['+draft/edit']
  if (edit) message.replaceId = edit
  return message
}

// TAGMSG carries the tag-only signals: typing, reactions, deletes
export function mapTagmsg(view: IrcView, line: IrcLine): IncomingMessage | null {
  const target = line.params[0]
  const nick = senderNick(line)
  if (!target || !nick) return null
  const channel = isChannelTarget(target, view.isupport)
  const self = isSelf(view, nick)
  const message: IncomingMessage = channel
    ? {
        from: `${viewJid(view, target)}/${nick}`,
        to: viewJid(view, target),
        body: '',
        type: 'groupchat',
        nick
      }
    : {
        from: self ? view.accountBare : viewJid(view, nick),
        to: self ? viewJid(view, target) : view.accountBare,
        body: '',
        type: 'chat'
      }
  const msgid = line.tags['msgid']
  if (msgid) {
    message.stanzaId = msgid
    message.stanzaBy = view.domain
  }
  const time = timeTag(line)
  if (time !== undefined) message.delay = time
  if (isMam(view, line)) message.mam = true
  if (isSelf(view, nick) && !channel && !isMam(view, line)) message.carbon = 'sent'
  const account = line.tags['account']
  if (account && account !== '*') message.occupantId = account
  const reply = line.tags['+draft/reply'] ?? line.tags['+reply']
  const react = line.tags['+draft/react'] ?? line.tags['+react']
  const unreact = line.tags['+draft/unreact'] ?? line.tags['+unreact']
  if (reply && react) {
    message.reactionTo = { id: reply, emojis: [react] }
  }
  if (reply && unreact) {
    message.reactionTo = { id: reply, emojis: [unreact], remove: true }
  }
  const del = line.tags['+draft/delete']
  if (del) message.retractId = del
  const typing = chatStateOf(line.tags['+typing'])
  if (typing) message.chatState = typing
  return message
}

// occupant record for a membership change. self marks our own rows so
// ChatStore tracks join state and renames
export function occupantOf(
  view: IrcView,
  channel: string,
  nick: string,
  presence: 'online' | 'offline',
  extra?: Partial<MucOccupant>
): MucOccupant {
  return {
    room: viewJid(view, channel),
    nick,
    presence,
    affiliation: extra?.affiliation ?? 'member',
    role: extra?.role ?? 'participant',
    self: isSelf(view, nick),
    codes: extra?.codes ?? [],
    ...extra
  }
}

// MONITOR and AWAY traffic -> presence updates for rostered nicks
export function presenceOf(
  view: IrcView,
  nick: string,
  show: 'online' | 'offline' | 'away',
  status = ''
): PresenceUpdate | null {
  if (!nick) return null
  return { from: viewJid(view, nick), show, status }
}

// MARKREAD <target> timestamp=...|* -> peer + ms timestamp for the
// readMarker event. Two directions land here: an echo of our own
// markread (peer sits in params[0]) and a notification that the peer
// read our traffic (peer is the sender).
export function mapMarkread(
  view: IrcView,
  line: IrcLine
): { peer: string; timestamp: number } | null {
  const target = line.params[0]
  const stamp = line.params[1]
  if (!target || !stamp?.startsWith('timestamp=')) return null
  const ms = Date.parse(stamp.slice('timestamp='.length))
  if (!Number.isFinite(ms)) return null
  // channel markers always name the conversation in params[0]. For
  // dms, an echo of ours names the peer there, while a peer-side
  // notification names the peer in the prefix
  const sender = senderNick(line)
  const peer = isChannelTarget(target, view.isupport) || isSelf(view, sender) ? target : sender
  if (!peer) return null
  return { peer: viewJid(view, peer), timestamp: ms }
}
