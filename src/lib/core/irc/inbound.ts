// Inbound dispatch: one parsed IRC line in, typed events out. Free
// functions over an IrcContext so tests can drive them without a
// socket. Channel membership handlers live in occupants.ts.

import type {
  IncomingMessage,
  MamPageResult,
  MucInvite,
  MucOccupant,
  PresenceError,
  PresenceUpdate
} from '$lib/core/xmpp/stanzas'

import {
  JOIN_ERROR_CONDITIONS,
  RPL_MONOFFLINE,
  RPL_MONONLINE,
  RPL_NAMREPLY,
  RPL_NOTOPIC,
  RPL_TOPIC,
  targetToJid
} from './address'
import { prefixNick, type IrcLine } from './line'
import {
  mapMarkread,
  mapPrivmsg,
  mapTagmsg,
  presenceOf,
  senderJid,
  senderNick,
  isSelf,
  type IrcView
} from './mapping'
import {
  onJoin,
  onKick,
  onMode,
  onNames,
  onNick,
  onPart,
  onQuit,
  onTopic,
  onTopicReply
} from './occupants'

interface IrcHooks {
  message(message: IncomingMessage): void
  occupant(occupant: MucOccupant): void
  presence(presence: PresenceUpdate): void
  presenceError(error: PresenceError): void
  invite(invite: MucInvite): void
  readMarker(peer: string, timestamp: number): void
  historyDone(result: MamPageResult): void
}

interface Batch {
  type: string
  count: number
  // draft/chathistory-end tag on the BATCH start, when sent
  end?: boolean | undefined
  // msgid of the first message in the batch, the older-page cursor
  firstMsgid?: string | undefined
  // multiline accumulator plus its first line for sender context
  lines?: string[] | undefined
  first?: IrcLine | undefined
}

// everything the dispatcher needs off the connection
export interface IrcContext {
  view: IrcView
  hooks: IrcHooks
  // channel-scoped nick membership, for QUIT fan-out and self checks
  addMember(channel: string, nick: string): void
  dropMember(channel: string, nick: string): void
  channelsWith(nick: string): string[]
  renameMember(oldNick: string, newNick: string): string[]
  // our nick just changed: update the view before occupant events
  noteNick(newNick: string): void
  monitored(nick: string): boolean
  renameMonitored(oldNick: string, newNick: string): void
  blocked(nick: string): boolean
  // labeled-response correlation for send failures
  failLabel(label: string, text: string, condition?: string): void
}

export class Inbound {
  private batches = new Map<string, Batch>()
  private pendingHistory: { limit: number } | null = null

  constructor(private readonly ctx: IrcContext) {}

  // a CHATHISTORY query is in flight. The next chathistory batch or
  // FAIL resolves it and limit feeds the batch-exhaustion heuristic
  noteHistory(limit: number): void {
    this.pendingHistory = { limit }
  }

  batchType(ref: string): string | undefined {
    return this.batches.get(ref)?.type
  }

  handle(line: IrcLine): void {
    const { ctx } = this
    switch (line.command) {
      case 'PRIVMSG':
        this.onPrivmsg(line)
        break
      case 'TAGMSG':
        this.onTagmsg(line)
        break
      case 'JOIN':
        onJoin(ctx, line)
        break
      case 'PART':
        onPart(ctx, line)
        break
      case 'QUIT':
        onQuit(ctx, line)
        break
      case 'KICK':
        onKick(ctx, line)
        break
      case 'NICK':
        onNick(ctx, line)
        break
      case 'MODE':
        onMode(ctx, line)
        break
      case 'TOPIC':
        onTopic(ctx, line)
        break
      case 'INVITE':
        this.onInvite(line)
        break
      case 'AWAY':
        this.onAway(line)
        break
      case 'BATCH':
        this.onBatch(line)
        break
      case 'MARKREAD': {
        const marker = mapMarkread(ctx.view, line)
        if (marker) ctx.hooks.readMarker(marker.peer, marker.timestamp)
        break
      }
      case 'FAIL': {
        if (line.params[0] === 'CHATHISTORY') this.finishHistory(undefined, true)
        const label = line.tags['label']
        if (label) ctx.failLabel(label, line.text)
        break
      }
      case RPL_NAMREPLY:
        onNames(ctx, line)
        break
      case RPL_NOTOPIC:
      case RPL_TOPIC:
        onTopicReply(ctx, line)
        break
      case RPL_MONONLINE:
      case RPL_MONOFFLINE:
        this.onMonitor(line, line.command === RPL_MONONLINE)
        break
      default:
        this.onNumeric(line)
    }
  }

  private emit(message: IncomingMessage | null): void {
    if (message) this.ctx.hooks.message(message)
  }

  private blockedSender(line: IrcLine): boolean {
    const nick = senderNick(line)
    return nick !== '' && !isSelf(this.ctx.view, nick) && this.ctx.blocked(nick)
  }

  private batchOf(line: IrcLine): Batch | undefined {
    const ref = line.tags['batch']
    return ref === undefined ? undefined : this.batches.get(ref)
  }

  private onPrivmsg(line: IrcLine): void {
    const batch = this.batchOf(line)
    if (batch?.type === 'draft/multiline') {
      batch.lines ??= []
      // draft/multiline-concat is valueless: join onto the previous
      // line instead of starting a new one
      const prev = 'draft/multiline-concat' in line.tags ? (batch.lines.pop() ?? '') : ''
      batch.lines.push(prev + line.text)
      batch.first ??= line
      return
    }
    if (batch?.type === 'chathistory') {
      batch.count++
      batch.firstMsgid ??= line.tags['msgid']
    }
    if (this.blockedSender(line)) return
    this.emit(mapPrivmsg(this.ctx.view, line))
  }

  private onTagmsg(line: IrcLine): void {
    const batch = this.batchOf(line)
    if (batch?.type === 'chathistory') batch.count++
    if (this.blockedSender(line)) return
    this.emit(mapTagmsg(this.ctx.view, line))
  }

  private onInvite(line: IrcLine): void {
    const channel = line.params[1] ?? line.text
    const nick = senderNick(line)
    if (!channel || !nick) return
    this.ctx.hooks.invite({
      room: targetToJid(channel, this.ctx.view.domain, this.ctx.view.isupport),
      from: senderJid(this.ctx.view, line),
      kind: 'mediated'
    })
  }

  private onAway(line: IrcLine): void {
    // away-notify carries the nick in the prefix, the only param is
    // the optional away message
    const nick = senderNick(line)
    if (!nick || !this.ctx.monitored(nick)) return
    const away = line.text !== ''
    const presence = presenceOf(this.ctx.view, nick, away ? 'away' : 'online', line.text)
    if (presence) this.ctx.hooks.presence(presence)
  }

  private onBatch(line: IrcLine): void {
    const ref = line.params[0]
    if (!ref) return
    if (ref.startsWith('+')) {
      const end = line.tags['draft/chathistory-end']
      this.batches.set(ref.slice(1), {
        type: line.params[1] ?? '',
        count: 0,
        ...(end !== undefined ? { end: end === 'true' } : {})
      })
      return
    }
    const batch = this.batches.get(ref.slice(1))
    this.batches.delete(ref.slice(1))
    if (!batch) return
    if (batch.type === 'chathistory') this.finishHistory(batch, false)
    if (batch.type === 'draft/multiline' && batch.lines && batch.first) {
      const joined = batch.lines.join('\n')
      const first = batch.first
      this.emit(
        mapPrivmsg(this.ctx.view, {
          ...first,
          text: joined,
          params: [...first.params.slice(0, -1), joined]
        })
      )
    }
  }

  private finishHistory(batch: Batch | undefined, failed: boolean): void {
    const pending = this.pendingHistory
    if (!pending) return
    this.pendingHistory = null
    // draft/chathistory-end=true is authoritative. Without it a short
    // page means the archive ran out
    const complete =
      failed || (batch?.end !== undefined ? batch.end : (batch?.count ?? 0) < pending.limit)
    const result: MamPageResult = { complete }
    if (!failed && batch?.firstMsgid) result.first = batch.firstMsgid
    this.ctx.hooks.historyDone(result)
  }

  private onMonitor(line: IrcLine, online: boolean): void {
    for (const entry of line.text.split(',').filter(Boolean)) {
      const nick = prefixNick(entry)
      if (!nick) continue
      const presence = presenceOf(this.ctx.view, nick, online ? 'online' : 'offline')
      if (presence) this.ctx.hooks.presence(presence)
    }
  }

  private onNumeric(line: IrcLine): void {
    // label-correlated failures: any error numeric tagged with our
    // send label marks the stored message failed
    const label = line.tags['label']
    if (label && (line.command.startsWith('4') || line.command.startsWith('5'))) {
      this.ctx.failLabel(label, line.text, JOIN_ERROR_CONDITIONS[line.command] ?? 'item-not-found')
      return
    }
    const condition = JOIN_ERROR_CONDITIONS[line.command]
    if (!condition) return
    // join errors name the channel in params[1] (params[0] is us)
    const channel = line.params[1]
    if (!channel) return
    this.ctx.hooks.presenceError({
      from: targetToJid(channel, this.ctx.view.domain, this.ctx.view.isupport),
      code: line.command,
      condition,
      text: line.text
    })
  }
}
