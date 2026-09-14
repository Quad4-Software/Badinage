import { describe, expect, it, vi } from 'vitest'

import { parseLine } from '../line'
import { IrcSession, type SessionHooks } from '../session'

function makeSession(nick = 'me', password = 'pw') {
  const sent: string[] = []
  const hooks: SessionHooks = {
    send: (line) => sent.push(line),
    onRegistered: vi.fn(),
    onAuthFail: vi.fn(),
    onError: vi.fn()
  }
  const session = new IrcSession(nick, password, hooks)
  return { session, sent, hooks }
}

function feed(session: IrcSession, raw: string) {
  const line = parseLine(raw)
  if (!line) throw new Error(`bad test line: ${raw}`)
  session.handle(line)
}

describe('IrcSession registration', () => {
  it('opens with CAP LS, NICK and USER', () => {
    const { session, sent } = makeSession()
    session.start()
    expect(sent).toEqual(['CAP LS 302', 'NICK me', 'USER badinage 0 * :Badinage'])
  })

  it('requests only the caps the server offered', () => {
    const { session, sent } = makeSession()
    session.start()
    feed(session, ':srv CAP * LS :sasl=PLAIN server-time echo-message unrelated-cap')
    const req = sent.find((l) => l.startsWith('CAP REQ'))
    expect(req).toBe('CAP REQ :sasl server-time echo-message')
    expect(req).not.toContain('unrelated-cap')
    expect(req).not.toContain('draft/chathistory')
  })

  it('waits for multiline LS before requesting', () => {
    const { session, sent } = makeSession()
    session.start()
    feed(session, ':srv CAP * LS * :sasl')
    expect(sent.some((l) => l.startsWith('CAP REQ'))).toBe(false)
    feed(session, ':srv CAP * LS :server-time')
    expect(sent.find((l) => l.startsWith('CAP REQ'))).toBe('CAP REQ :sasl server-time')
  })

  it('ends negotiation when nothing wanted is offered', () => {
    const { session, sent } = makeSession()
    session.start()
    feed(session, ':srv CAP * LS :unrelated-cap')
    expect(sent.at(-1)).toBe('CAP END')
  })

  it('runs SASL PLAIN after the sasl ack', () => {
    const { session, sent } = makeSession()
    session.start()
    feed(session, ':srv CAP * LS :sasl server-time')
    feed(session, ':srv CAP * ACK :sasl server-time')
    expect(sent).toContain('AUTHENTICATE PLAIN')
    feed(session, 'AUTHENTICATE +')
    const payload = sent.find((l) => l.startsWith('AUTHENTICATE ') && l !== 'AUTHENTICATE PLAIN')
    expect(payload).toBe(`AUTHENTICATE ${btoa('\0me\0pw')}`)
    feed(session, ':srv 903 me :SASL success')
    expect(sent.at(-1)).toBe('CAP END')
  })

  it('reports registered on 001 with the server nick', () => {
    const { session, hooks } = makeSession()
    session.start()
    feed(session, ':srv CAP * LS :server-time')
    feed(session, ':srv CAP * ACK :server-time')
    feed(session, ':srv 001 me :Welcome')
    expect(hooks.onRegistered).toHaveBeenCalledWith('me')
    expect(session.registered).toBe(true)
  })

  it('adopts a server-forced nick from the welcome target', () => {
    const { session, hooks } = makeSession()
    session.start()
    feed(session, ':srv 001 guest42 :Welcome')
    expect(hooks.onRegistered).toHaveBeenCalledWith('guest42')
    expect(session.currentNick).toBe('guest42')
  })

  it('fails authentication on sasl errors', () => {
    const { session, hooks } = makeSession()
    session.start()
    feed(session, ':srv 904 me :SASL failed')
    expect(hooks.onAuthFail).toHaveBeenCalled()
  })

  it('fails authentication on password mismatch', () => {
    const { session, hooks } = makeSession()
    session.start()
    feed(session, ':srv 464 me :Password incorrect')
    expect(hooks.onAuthFail).toHaveBeenCalled()
  })

  it('retries a nick collision once with a suffix', () => {
    const { session, sent, hooks } = makeSession()
    session.start()
    feed(session, ':srv 433 * me :Nickname in use')
    expect(sent.at(-1)).toBe('NICK me_')
    feed(session, ':srv 433 * me_ :Nickname in use')
    expect(hooks.onError).toHaveBeenCalled()
    expect(sent.filter((l) => l === 'NICK me_')).toHaveLength(1)
  })

  it('ignores nick-in-use after registration', () => {
    const { session, sent, hooks } = makeSession()
    session.start()
    feed(session, ':srv 001 me :Welcome')
    feed(session, ':srv 433 * me :Nickname in use')
    expect(sent.filter((l) => l.startsWith('NICK'))).toHaveLength(1)
    expect(hooks.onError).not.toHaveBeenCalled()
  })

  it('picks up wanted caps announced via cap-notify NEW', () => {
    const { session, sent } = makeSession()
    session.start()
    feed(session, ':srv CAP * LS :cap-notify server-time')
    feed(session, ':srv CAP * ACK :cap-notify server-time')
    feed(session, ':srv CAP me NEW :draft/read-marker other-cap')
    expect(sent.at(-1)).toBe('CAP REQ :draft/read-marker')
  })

  it('drops caps revoked via cap-notify DEL', () => {
    const { session } = makeSession()
    session.start()
    feed(session, ':srv CAP * LS :server-time')
    feed(session, ':srv CAP * ACK :server-time')
    expect(session.caps.has('server-time')).toBe(true)
    feed(session, ':srv CAP me DEL :server-time')
    expect(session.caps.has('server-time')).toBe(false)
  })
})
