import { describe, expect, it } from 'vitest'

import { defaultISupport } from '../address'
import { parseLine } from '../line'
import {
  mapMarkread,
  mapPrivmsg,
  mapTagmsg,
  occupantOf,
  presenceOf,
  type IrcView
} from '../mapping'

function makeView(overrides: Partial<IrcView> = {}): IrcView {
  return {
    domain: 'irc.example.org',
    isupport: defaultISupport(),
    ourNick: 'me',
    accountBare: 'me@irc.example.org',
    batchType: () => undefined,
    ...overrides
  }
}

function line(raw: string) {
  const parsed = parseLine(raw)
  if (!parsed) throw new Error(`bad test line: ${raw}`)
  return parsed
}

describe('mapPrivmsg', () => {
  it('maps a channel message to groupchat', () => {
    const m = mapPrivmsg(makeView(), line(':alice!u@h PRIVMSG #chan :hello'))
    expect(m?.type).toBe('groupchat')
    expect(m?.to).toBe('#chan@irc.example.org')
    expect(m?.from).toBe('#chan@irc.example.org/alice')
    expect(m?.nick).toBe('alice')
    expect(m?.body).toBe('hello')
  })

  it('maps a dm to chat between the two jids', () => {
    const m = mapPrivmsg(makeView(), line(':alice!u@h PRIVMSG me :hi'))
    expect(m?.type).toBe('chat')
    expect(m?.from).toBe('alice@irc.example.org')
    expect(m?.to).toBe('me@irc.example.org')
    expect(m?.carbon).toBeUndefined()
  })

  it('folds a self dm echo to the account jid as a sent carbon', () => {
    const m = mapPrivmsg(makeView(), line(':me!u@h PRIVMSG alice :hi'))
    expect(m?.from).toBe('me@irc.example.org')
    expect(m?.to).toBe('alice@irc.example.org')
    expect(m?.carbon).toBe('sent')
  })

  it('adopts the echoed label as the message id for dedup', () => {
    const m = mapPrivmsg(makeView(), line('@label=local-1 :me!u@h PRIVMSG alice :hi'))
    expect(m?.id).toBe('local-1')
    expect(m?.carbon).toBe('sent')
  })

  it('does not mark groupchat echoes as carbons', () => {
    const m = mapPrivmsg(makeView(), line(':me!u@h PRIVMSG #chan :hi'))
    expect(m?.carbon).toBeUndefined()
  })

  it('maps msgid and server-time', () => {
    const m = mapPrivmsg(
      makeView(),
      line('@msgid=xyz;time=2024-01-01T12:00:00Z :alice!u@h PRIVMSG #chan :hi')
    )
    expect(m?.stanzaId).toBe('xyz')
    expect(m?.stanzaBy).toBe('irc.example.org')
    expect(m?.delay).toBe(Date.parse('2024-01-01T12:00:00Z'))
  })

  it('marks archive traffic inside a chathistory batch', () => {
    const view = makeView({ batchType: (ref) => (ref === 'b1' ? 'chathistory' : undefined) })
    const m = mapPrivmsg(view, line('@batch=b1 :alice!u@h PRIVMSG #chan :old'))
    expect(m?.mam).toBe(true)
  })

  it('maps CTCP ACTION to the /me convention', () => {
    const m = mapPrivmsg(makeView(), line(':alice!u@h PRIVMSG #chan :\x01ACTION waves\x01'))
    expect(m?.body).toBe('/me waves')
  })

  it('strips mirc formatting from the body', () => {
    const m = mapPrivmsg(makeView(), line(':a!u@h PRIVMSG #chan :\x034red\x0f'))
    expect(m?.body).toBe('red')
  })

  it('maps reply and edit client tags', () => {
    const reply = mapPrivmsg(makeView(), line('@+draft/reply=orig :a!u@h PRIVMSG #chan :re'))
    expect(reply?.replyTo?.id).toBe('orig')
    const edit = mapPrivmsg(makeView(), line('@+draft/edit=orig :a!u@h PRIVMSG #chan :fixed'))
    expect(edit?.replaceId).toBe('orig')
  })

  it('records the services account as the occupant id', () => {
    const m = mapPrivmsg(makeView(), line('@account=alice42 :a!u@h PRIVMSG #chan :hi'))
    expect(m?.occupantId).toBe('alice42')
  })

  it('returns null for malformed lines', () => {
    expect(mapPrivmsg(makeView(), line('PRIVMSG'))).toBeNull()
  })
})

describe('mapTagmsg', () => {
  it('maps typing tags to chat states', () => {
    const active = mapTagmsg(makeView(), line('@+typing=active :a!u@h TAGMSG me'))
    expect(active?.chatState).toBe('composing')
    const paused = mapTagmsg(makeView(), line('@+typing=paused :a!u@h TAGMSG me'))
    expect(paused?.chatState).toBe('paused')
    const done = mapTagmsg(makeView(), line('@+typing=done :a!u@h TAGMSG me'))
    expect(done?.chatState).toBe('active')
  })

  it('maps reactions and unreacts', () => {
    const react = mapTagmsg(makeView(), line('@+draft/react=👍;+draft/reply=m1 :a!u@h TAGMSG #c'))
    expect(react?.reactionTo).toEqual({ id: 'm1', emojis: ['👍'] })
    const unreact = mapTagmsg(
      makeView(),
      line('@+draft/unreact=👍;+draft/reply=m1 :a!u@h TAGMSG #c')
    )
    expect(unreact?.reactionTo).toEqual({ id: 'm1', emojis: ['👍'], remove: true })
  })

  it('maps deletes to retractions', () => {
    const del = mapTagmsg(makeView(), line('@+draft/delete=m1 :a!u@h TAGMSG #c'))
    expect(del?.retractId).toBe('m1')
  })

  it('returns null for malformed lines', () => {
    expect(mapTagmsg(makeView(), line('TAGMSG'))).toBeNull()
  })
})

describe('occupantOf / presenceOf / mapMarkread', () => {
  it('marks our own occupant rows self', () => {
    const occ = occupantOf(makeView(), '#chan', 'me', 'online')
    expect(occ.self).toBe(true)
    expect(occ.room).toBe('#chan@irc.example.org')
    const other = occupantOf(makeView(), '#chan', 'alice', 'online')
    expect(other.self).toBe(false)
  })

  it('builds presence updates for rostered nicks', () => {
    const p = presenceOf(makeView(), 'alice', 'away', 'lunch')
    expect(p).toEqual({ from: 'alice@irc.example.org', show: 'away', status: 'lunch' })
    expect(presenceOf(makeView(), '', 'online')).toBeNull()
  })

  it('parses a MARKREAD timestamp', () => {
    // the echo of our own markread carries the target in params[0]
    const m = mapMarkread(makeView(), line(':me!u@h MARKREAD alice timestamp=2024-01-01T12:00:00Z'))
    expect(m?.peer).toBe('alice@irc.example.org')
    expect(m?.timestamp).toBe(Date.parse('2024-01-01T12:00:00Z'))
  })

  it('parses a peer-side MARKREAD notification', () => {
    // alice read our messages: the peer is the sender, not params[0]
    const m = mapMarkread(makeView(), line(':alice!u@h MARKREAD me timestamp=2024-01-01T12:00:00Z'))
    expect(m?.peer).toBe('alice@irc.example.org')
  })

  it('rejects markread lines without a timestamp param', () => {
    expect(mapMarkread(makeView(), line(':a!u@h MARKREAD me'))).toBeNull()
  })
})
