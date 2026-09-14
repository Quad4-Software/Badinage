import { describe, expect, it } from 'vitest'

import {
  ctcpAction,
  ircEqual,
  ircLower,
  parseLine,
  prefixNick,
  serializeLine,
  splitMessage,
  stripMirc
} from '../line'

describe('parseLine', () => {
  it('parses a bare command with trailing text', () => {
    const line = parseLine('PRIVMSG #chan :hello world')
    expect(line).toEqual({
      tags: {},
      prefix: undefined,
      command: 'PRIVMSG',
      params: ['#chan', 'hello world'],
      text: 'hello world'
    })
  })

  it('parses prefix and middle params', () => {
    const line = parseLine(':nick!u@h JOIN #chan')
    expect(line?.prefix).toBe('nick!u@h')
    expect(line?.command).toBe('JOIN')
    expect(line?.params).toEqual(['#chan'])
  })

  it('uppercases the command', () => {
    expect(parseLine(':a privmsg #c :x')?.command).toBe('PRIVMSG')
  })

  it('parses message tags with values and flags', () => {
    const line = parseLine('@msgid=abc;time=2024-01-01T00:00:00Z;+typing :n!u@h TAGMSG #c')
    expect(line?.tags['msgid']).toBe('abc')
    expect(line?.tags['time']).toBe('2024-01-01T00:00:00Z')
    expect(line?.tags['+typing']).toBeUndefined()
  })

  it('unescapes tag values', () => {
    const line = parseLine('@m=a\\sb\\:c\\\\d\\r\\n :x CMD')
    expect(line?.tags['m']).toBe('a b;c\\d\r\n')
  })

  it('returns null for empty and tag-only input', () => {
    expect(parseLine('')).toBeNull()
    expect(parseLine('@tag=1')).toBeNull()
  })

  it('handles a trailing param that starts with a colon', () => {
    const line = parseLine(':a PRIVMSG #c ::leading')
    expect(line?.text).toBe(':leading')
  })
})

describe('serializeLine', () => {
  it('round-trips a tagged line', () => {
    const raw = '@a=b :n!u@h PRIVMSG #c :hi there'
    const line = parseLine(raw)
    if (!line) throw new Error('parse failed')
    expect(serializeLine({ ...line, params: line.params.slice(0, -1).concat(line.text) })).toBe(raw)
  })

  it('emits trailing form for params with spaces', () => {
    expect(serializeLine({ command: 'PRIVMSG', params: ['#c', 'hi there'] })).toBe(
      'PRIVMSG #c :hi there'
    )
  })

  it('escapes tag values', () => {
    expect(serializeLine({ tags: { m: 'a b;c' }, command: 'TAGMSG', params: ['#c'] })).toBe(
      '@m=a\\sb\\:c TAGMSG #c'
    )
  })
})

describe('prefixNick', () => {
  it('strips userhost', () => {
    expect(prefixNick('nick!user@host')).toBe('nick')
    expect(prefixNick('irc.example.org')).toBe('irc.example.org')
    expect(prefixNick(undefined)).toBe('')
  })
})

describe('casemapping', () => {
  it('folds rfc1459 specials', () => {
    expect(ircLower('Nick[\\]~')).toBe('nick{|}^')
    expect(ircEqual('Nick[x]', 'nick{x}')).toBe(true)
  })

  it('ascii only lowercases letters', () => {
    expect(ircEqual('Nick[x]', 'nick{x}', 'ascii')).toBe(false)
    expect(ircEqual('Nick[x]', 'nick[x]', 'ascii')).toBe(true)
  })

  it('strict-rfc1459 keeps tilde distinct', () => {
    expect(ircEqual('a~', 'a^', 'strict-rfc1459')).toBe(false)
    expect(ircEqual('a~', 'a^', 'rfc1459')).toBe(true)
  })
})

describe('stripMirc', () => {
  it('removes color codes and args', () => {
    expect(stripMirc('\x034,12red\x0f plain')).toBe('red plain')
  })

  it('removes hex colors and attribute codes', () => {
    expect(stripMirc('\x04aabbcc\x02bold\x1funder')).toBe('boldunder')
  })
})

describe('ctcpAction', () => {
  it('extracts the action body', () => {
    expect(ctcpAction('\x01ACTION waves\x01')).toBe('waves')
  })

  it('returns null for plain text and other ctcp', () => {
    expect(ctcpAction('hello')).toBeNull()
    expect(ctcpAction('\x01VERSION\x01')).toBeNull()
  })
})

describe('splitMessage', () => {
  it('leaves short bodies alone', () => {
    expect(splitMessage('hi')).toEqual(['hi'])
  })

  it('splits long bodies on code point boundaries', () => {
    const body = 'word '.repeat(200).trim()
    const parts = splitMessage(body, 100)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(100)
    }
    expect(parts.join('')).toBe(body)
  })

  it('never splits a multibyte codepoint', () => {
    const body = 'x'.repeat(90) + 'é'.repeat(20)
    for (const part of splitMessage(body, 100)) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(100)
      expect(part).not.toContain('�')
    }
  })
})
