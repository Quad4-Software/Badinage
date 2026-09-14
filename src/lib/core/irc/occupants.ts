// Channel membership handlers for the inbound dispatcher: JOIN, PART,
// QUIT, KICK, NICK, MODE, NAMES and TOPIC. Each emits MucOccupant or
// subject message events the same way XMPP presence does.

import type { IrcLine } from './line'
import { ircLower, type CaseMapping } from './line'
import { SELF_KICKED_CODE, SELF_RENAMED_CODE } from '$lib/core/xmpp/features/muc'

import { RPL_NOTOPIC, isChannelTarget, prefixToRole, targetToJid } from './address'
import type { IrcContext } from './inbound'
import { isSelf, occupantOf, presenceOf, senderNick } from './mapping'

export function onJoin(ctx: IrcContext, line: IrcLine): void {
  const channel = line.params[0] ?? line.text
  const nick = senderNick(line)
  if (!channel || !nick) return
  ctx.addMember(channel, nick)
  // extended-join carries the services account as a stable occupant id
  const account = line.params[1]
  ctx.hooks.occupant(
    occupantOf(ctx.view, channel, nick, 'online', {
      ...(account && account !== '*' ? { occupantId: account } : {})
    })
  )
}

export function onPart(ctx: IrcContext, line: IrcLine): void {
  const channel = line.params[0]
  const nick = senderNick(line)
  if (!channel || !nick) return
  ctx.dropMember(channel, nick)
  ctx.hooks.occupant(
    occupantOf(ctx.view, channel, nick, 'offline', { reason: line.text || undefined })
  )
}

export function onQuit(ctx: IrcContext, line: IrcLine): void {
  const nick = senderNick(line)
  if (!nick) return
  for (const channel of ctx.channelsWith(nick)) {
    ctx.dropMember(channel, nick)
    ctx.hooks.occupant(
      occupantOf(ctx.view, channel, nick, 'offline', { reason: line.text || undefined })
    )
  }
  if (ctx.monitored(nick)) {
    const presence = presenceOf(ctx.view, nick, 'offline')
    if (presence) ctx.hooks.presence(presence)
  }
}

export function onKick(ctx: IrcContext, line: IrcLine): void {
  const channel = line.params[0]
  const target = line.params[1]
  if (!channel || !target) return
  ctx.dropMember(channel, target)
  ctx.hooks.occupant(
    occupantOf(ctx.view, channel, target, 'offline', {
      codes: isSelf(ctx.view, target) ? [SELF_KICKED_CODE] : [],
      reason: line.text || undefined
    })
  )
}

export function onNick(ctx: IrcContext, line: IrcLine): void {
  const oldNick = senderNick(line)
  const newNick = line.params[0] ?? line.text
  if (!oldNick || !newNick) return
  const self = isSelf(ctx.view, oldNick)
  const channels = ctx.renameMember(oldNick, newNick)
  if (self) ctx.noteNick(newNick)
  for (const channel of channels) {
    ctx.hooks.occupant(
      occupantOf(ctx.view, channel, oldNick, 'offline', {
        codes: self ? [SELF_RENAMED_CODE] : [],
        newNick
      })
    )
    ctx.hooks.occupant(occupantOf(ctx.view, channel, newNick, 'online'))
  }
  // a monitored contact's presence address follows the rename
  if (ctx.monitored(oldNick)) {
    ctx.renameMonitored(oldNick, newNick)
    const off = presenceOf(ctx.view, oldNick, 'offline')
    const on = presenceOf(ctx.view, newNick, 'online')
    if (off) ctx.hooks.presence(off)
    if (on) ctx.hooks.presence(on)
  }
}

export function onMode(ctx: IrcContext, line: IrcLine): void {
  const channel = line.params[0]
  if (!channel || !isChannelTarget(channel, ctx.view.isupport)) return
  const modes = line.params[1] ?? ''
  const args = line.params.slice(2)
  let adding = true
  let argi = 0
  for (const char of modes) {
    if (char === '+') {
      adding = true
      continue
    }
    if (char === '-') {
      adding = false
      continue
    }
    const prefixIndex = ctx.view.isupport.prefixModes.indexOf(char)
    if (prefixIndex !== -1) {
      const nick = args[argi++]
      if (!nick) continue
      const prefixChar = ctx.view.isupport.prefixChars[prefixIndex] ?? ''
      const role = adding
        ? prefixToRole(prefixChar, ctx.view.isupport)
        : { affiliation: 'member', role: 'participant' }
      ctx.hooks.occupant(occupantOf(ctx.view, channel, nick, 'online', role))
      continue
    }
    // list modes (b,e,I,q) and k always take an arg. l takes one only
    // when set
    if ('beIqk'.includes(char) || (adding && char === 'l')) argi++
  }
}

export function onTopic(ctx: IrcContext, line: IrcLine): void {
  const channel = line.params[0]
  if (channel) emitTopic(ctx, channel, line.text)
}

// 332 me #chan :topic / 331 me #chan :No topic
export function onTopicReply(ctx: IrcContext, line: IrcLine): void {
  const channel = line.params[1]
  if (!channel) return
  emitTopic(ctx, channel, line.command === RPL_NOTOPIC ? '' : line.text)
}

function emitTopic(ctx: IrcContext, channel: string, subject: string): void {
  const room = targetToJid(channel, ctx.view.domain, ctx.view.isupport)
  ctx.hooks.message({ from: room, to: room, body: '', type: 'groupchat', subject })
}

// 353 me = #chan :@op +voice nick
export function onNames(ctx: IrcContext, line: IrcLine): void {
  const channel = line.params[2]
  if (!channel) return
  for (const raw of line.text.split(' ').filter(Boolean)) {
    let prefixes = ''
    let nick = raw
    while (nick && ctx.view.isupport.prefixChars.includes(nick[0] ?? '')) {
      prefixes += nick[0]
      nick = nick.slice(1)
    }
    // userhost-in-names can append !user@host
    const bang = nick.indexOf('!')
    if (bang !== -1) nick = nick.slice(0, bang)
    if (!nick) continue
    ctx.addMember(channel, nick)
    ctx.hooks.occupant(
      occupantOf(ctx.view, channel, nick, 'online', prefixToRole(prefixes, ctx.view.isupport))
    )
  }
}

// Channel membership tracking. IRC gives no occupant list delta for a
// QUIT - the client must know which channels shared the quitter, so
// the transport keeps a casemapped member set per joined channel.
export class Membership {
  private channels = new Map<string, Set<string>>()

  constructor(private readonly casemap: () => CaseMapping) {}

  private lower(name: string): string {
    return ircLower(name, this.casemap())
  }

  add(channel: string, nick: string): void {
    let members = this.channels.get(this.lower(channel))
    if (!members) {
      members = new Set()
      this.channels.set(this.lower(channel), members)
    }
    members.add(this.lower(nick))
  }

  remove(channel: string, nick: string): void {
    this.channels.get(this.lower(channel))?.delete(this.lower(nick))
  }

  has(channel: string, nick: string): boolean {
    return this.channels.get(this.lower(channel))?.has(this.lower(nick)) ?? false
  }

  // every channel the nick is visible in. QUIT fans out to all of them
  channelsWith(nick: string): string[] {
    const key = this.lower(nick)
    const out: string[] = []
    for (const [channel, members] of this.channels) {
      if (members.has(key)) out.push(channel)
    }
    return out
  }

  // rename across every channel, returns the channels that saw it
  rename(oldNick: string, newNick: string): string[] {
    const channels = this.channelsWith(oldNick)
    for (const channel of channels) {
      this.channels.get(channel)?.delete(this.lower(oldNick))
      this.channels.get(channel)?.add(this.lower(newNick))
    }
    return channels
  }

  clear(): void {
    this.channels.clear()
  }
}
