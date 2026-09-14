import { describe, expect, it, vi } from 'vitest'

import type {
  IncomingMessage,
  MamPageResult,
  MucInvite,
  MucOccupant,
  PresenceError,
  PresenceUpdate
} from '$lib/core/xmpp/stanzas'
import { SELF_KICKED_CODE, SELF_RENAMED_CODE } from '$lib/core/xmpp/features/muc'

import { defaultISupport } from '../address'
import { Inbound, type IrcContext } from '../inbound'
import { ircLower, parseLine } from '../line'
import type { IrcView } from '../mapping'
import { Membership } from '../occupants'

interface Events {
  messages: IncomingMessage[]
  occupants: MucOccupant[]
  presence: PresenceUpdate[]
  errors: PresenceError[]
  invites: MucInvite[]
  markers: { peer: string; timestamp: number }[]
  history: MamPageResult[]
}

function makeInbound() {
  const events: Events = {
    messages: [],
    occupants: [],
    presence: [],
    errors: [],
    invites: [],
    markers: [],
    history: []
  }
  const monitored = new Set<string>()
  const blocked = new Set<string>()
  const view: IrcView = {
    domain: 'irc.example.org',
    isupport: defaultISupport(),
    ourNick: 'me',
    accountBare: 'me@irc.example.org',
    batchType: () => undefined
  }
  const membership = new Membership(() => view.isupport.casemapping)
  const failLabel = vi.fn()
  const ctx: IrcContext = {
    view,
    hooks: {
      message: (m) => events.messages.push(m),
      occupant: (o) => events.occupants.push(o),
      presence: (p) => events.presence.push(p),
      presenceError: (e) => events.errors.push(e),
      invite: (i) => events.invites.push(i),
      readMarker: (peer, timestamp) => events.markers.push({ peer, timestamp }),
      historyDone: (r) => events.history.push(r)
    },
    addMember: (c, n) => membership.add(c, n),
    dropMember: (c, n) => membership.remove(c, n),
    channelsWith: (n) => membership.channelsWith(n),
    renameMember: (o, n) => membership.rename(o, n),
    noteNick: (n) => {
      view.ourNick = n
    },
    monitored: (n) => monitored.has(ircLower(n)),
    renameMonitored: (o, n) => {
      if (monitored.delete(ircLower(o))) monitored.add(ircLower(n))
    },
    blocked: (n) => blocked.has(ircLower(n)),
    failLabel
  }
  const inbound = new Inbound(ctx)
  // the view asks the dispatcher what a batch ref carries
  view.batchType = (ref) => inbound.batchType(ref)
  const feed = (raw: string) => {
    const parsed = parseLine(raw)
    if (!parsed) throw new Error(`bad test line: ${raw}`)
    inbound.handle(parsed)
  }
  return { events, monitored, blocked, view, membership, inbound, feed, failLabel }
}

describe('Inbound dispatch', () => {
  it('routes privmsg lines to the message hook', () => {
    const { events, feed } = makeInbound()
    feed(':alice!u@h PRIVMSG #chan :hi')
    expect(events.messages).toHaveLength(1)
    expect(events.messages[0]?.type).toBe('groupchat')
  })

  it('drops messages from blocked senders', () => {
    const { events, blocked, feed } = makeInbound()
    blocked.add('troll')
    feed(':troll!u@h PRIVMSG me :spam')
    feed(':alice!u@h PRIVMSG me :ok')
    expect(events.messages).toHaveLength(1)
  })

  it('emits occupants for join and part', () => {
    const { events, feed } = makeInbound()
    feed(':alice!u@h JOIN #chan')
    feed(':alice!u@h PART #chan :bye')
    expect(events.occupants.map((o) => o.presence)).toEqual(['online', 'offline'])
    expect(events.occupants[1]?.reason).toBe('bye')
  })

  it('fans a quit out to every shared channel', () => {
    const { events, feed } = makeInbound()
    feed(':alice!u@h JOIN #one')
    feed(':alice!u@h JOIN #two')
    feed(':bob!u@h JOIN #two')
    feed(':alice!u@h QUIT :gone')
    const rooms = events.occupants
      .filter((o) => o.nick === 'alice' && o.presence === 'offline')
      .map((o) => o.room)
    expect(rooms).toEqual(['#one@irc.example.org', '#two@irc.example.org'])
    expect(events.occupants.at(-1)?.reason).toBe('gone')
  })

  it('emits a monitored presence for a quitting contact', () => {
    const { events, monitored, feed } = makeInbound()
    monitored.add('alice')
    feed(':alice!u@h QUIT :gone')
    expect(events.presence).toEqual([
      { from: 'alice@irc.example.org', show: 'offline', status: '' }
    ])
  })

  it('renames occupants across channels and tracks our nick', () => {
    const { events, view, feed } = makeInbound()
    feed(':me!u@h JOIN #chan')
    feed(':alice!u@h JOIN #chan')
    feed(':me!u@h NICK me2')
    expect(view.ourNick).toBe('me2')
    const renamed = events.occupants.find((o) => o.newNick === 'me2')
    expect(renamed?.codes).toContain(SELF_RENAMED_CODE)
    expect(events.occupants.at(-1)?.nick).toBe('me2')
    expect(events.occupants.at(-1)?.self).toBe(true)
  })

  it('marks a self kick with the kicked code', () => {
    const { events, feed } = makeInbound()
    feed(':me!u@h JOIN #chan')
    feed(':op!u@h KICK #chan me :out')
    const kicked = events.occupants.at(-1)
    expect(kicked?.self).toBe(true)
    expect(kicked?.codes).toContain(SELF_KICKED_CODE)
  })

  it('maps names replies to role-carrying occupants', () => {
    const { events, feed } = makeInbound()
    feed(':srv 353 me = #chan :@op +voice nick')
    const roles = Object.fromEntries(events.occupants.map((o) => [o.nick, o.role]))
    expect(roles['op']).toBe('moderator')
    expect(roles['voice']).toBe('participant')
    expect(roles['nick']).toBe('participant')
  })

  it('maps extended mode prefixes to affiliations', () => {
    const { events, view, feed } = makeInbound()
    view.isupport.prefixModes = 'qaohv'
    view.isupport.prefixChars = '~&@%+'
    feed(':srv MODE #chan +q alice')
    expect(events.occupants.at(-1)?.affiliation).toBe('owner')
  })

  it('emits topics as subject messages', () => {
    const { events, feed } = makeInbound()
    feed(':alice!u@h TOPIC #chan :new topic')
    expect(events.messages[0]?.subject).toBe('new topic')
    feed(':srv 332 me #chan :old topic')
    expect(events.messages[1]?.subject).toBe('old topic')
    feed(':srv 331 me #chan :No topic')
    expect(events.messages[2]?.subject).toBe('')
  })

  it('maps monitor online and offline to presence', () => {
    const { events, feed } = makeInbound()
    feed(':srv 730 me :alice!u@h,bob!u@h')
    feed(':srv 731 me :alice')
    expect(events.presence.map((p) => p.show)).toEqual(['online', 'online', 'offline'])
  })

  it('maps away notifications only for monitored nicks', () => {
    const { events, monitored, feed } = makeInbound()
    monitored.add('alice')
    feed(':alice!u@h AWAY :lunch')
    feed(':stray!u@h AWAY :ignored')
    feed(':alice!u@h AWAY')
    expect(events.presence.map((p) => p.show)).toEqual(['away', 'online'])
  })

  it('emits a mediated invite', () => {
    const { events, feed } = makeInbound()
    feed(':alice!u@h INVITE me :#chan')
    expect(events.invites).toEqual([
      { room: '#chan@irc.example.org', from: 'alice@irc.example.org', kind: 'mediated' }
    ])
  })

  it('emits read markers with timestamps', () => {
    const { events, feed } = makeInbound()
    // a second client of ours marks the alice conversation read
    feed(':me!u@h MARKREAD alice timestamp=2024-01-01T12:00:00Z')
    expect(events.markers).toEqual([
      { peer: 'alice@irc.example.org', timestamp: Date.parse('2024-01-01T12:00:00Z') }
    ])
  })

  it('resolves a chathistory batch with the first msgid cursor', () => {
    const { events, inbound, feed } = makeInbound()
    inbound.noteHistory(50)
    feed(':srv BATCH +h1 chathistory #chan')
    feed('@batch=h1;msgid=m10 :alice!u@h PRIVMSG #chan :old1')
    feed('@batch=h1;msgid=m11 :alice!u@h PRIVMSG #chan :old2')
    feed(':srv BATCH -h1')
    expect(events.messages.every((m) => m.mam)).toBe(true)
    expect(events.history).toEqual([{ complete: true, first: 'm10' }])
  })

  it('marks a full chathistory page incomplete without the end tag', () => {
    const { events, inbound, feed } = makeInbound()
    inbound.noteHistory(2)
    feed(':srv BATCH +h2 chathistory #chan')
    feed('@batch=h2;msgid=m1 :a!u@h PRIVMSG #chan :one')
    feed('@batch=h2;msgid=m2 :a!u@h PRIVMSG #chan :two')
    feed(':srv BATCH -h2')
    expect(events.history[0]?.complete).toBe(false)
    expect(events.history[0]?.first).toBe('m1')
  })

  it('honours the draft/chathistory-end tag over the count heuristic', () => {
    const { events, inbound, feed } = makeInbound()
    inbound.noteHistory(50)
    feed('@draft/chathistory-end=true :srv BATCH +h3 chathistory #chan')
    feed('@batch=h3;msgid=m1 :a!u@h PRIVMSG #chan :one')
    feed(':srv BATCH -h3')
    expect(events.history[0]?.complete).toBe(true)
  })

  it('resolves a failed chathistory query', () => {
    const { events, inbound, feed } = makeInbound()
    inbound.noteHistory(50)
    feed(':srv FAIL CHATHISTORY MESSAGE_ERROR :nope')
    expect(events.history).toEqual([{ complete: true }])
  })

  it('joins a draft/multiline batch into one message', () => {
    const { events, feed } = makeInbound()
    feed(':srv BATCH +m draft/multiline #chan')
    feed('@batch=m :alice!u@h PRIVMSG #chan :first')
    feed('@batch=m;draft/multiline-concat :alice!u@h PRIVMSG #chan :half')
    feed('@batch=m :alice!u@h PRIVMSG #chan :second')
    feed(':srv BATCH -m')
    expect(events.messages).toHaveLength(1)
    expect(events.messages[0]?.body).toBe('firsthalf\nsecond')
  })

  it('reports labeled send failures through failLabel', () => {
    const { failLabel, feed } = makeInbound()
    feed('@label=send-1 :srv 401 me ghost :No such nick')
    expect(failLabel).toHaveBeenCalledWith('send-1', 'No such nick', 'item-not-found')
  })

  it('maps join failures to presenceError conditions', () => {
    const { events, feed } = makeInbound()
    feed(':srv 475 me #chan :Cannot join channel (+k)')
    expect(events.errors).toEqual([
      {
        from: '#chan@irc.example.org',
        code: '475',
        condition: 'not-authorized',
        text: 'Cannot join channel (+k)'
      }
    ])
  })
})
