import { describe, expect, it } from 'vitest'

import {
  bareJid,
  isValidAnonymousDomain,
  isValidBareJid,
  isValidUserJid,
  jidDomain,
  parseJid
} from './jid'

describe('parseJid', () => {
  it('parses a full jid', () => {
    expect(parseJid('romeo@example.net/phone')).toEqual({
      local: 'romeo',
      domain: 'example.net',
      resource: 'phone'
    })
  })

  it('parses a bare jid', () => {
    expect(parseJid('romeo@example.net')).toEqual({ local: 'romeo', domain: 'example.net' })
  })

  it('parses a domain-only jid', () => {
    expect(parseJid('example.net')).toEqual({ domain: 'example.net' })
  })

  it('keeps slashes inside the resource', () => {
    expect(parseJid('a@b.c/res/extra')).toEqual({
      local: 'a',
      domain: 'b.c',
      resource: 'res/extra'
    })
  })
})

describe('bareJid', () => {
  it('strips the resource', () => {
    expect(bareJid('romeo@example.net/phone')).toBe('romeo@example.net')
  })
})

describe('jidDomain', () => {
  it('returns the domain', () => {
    expect(jidDomain('romeo@example.net/phone')).toBe('example.net')
  })
})

describe('isValidBareJid', () => {
  it('accepts a normal jid', () => {
    expect(isValidBareJid('romeo@example.net')).toBe(true)
  })

  it('accepts single-label domains for local dev servers', () => {
    expect(isValidBareJid('romeo@localhost')).toBe(true)
  })

  it('rejects an empty jid', () => {
    expect(isValidBareJid('')).toBe(false)
  })
})

describe('isValidUserJid', () => {
  it('accepts a local@domain jid', () => {
    expect(isValidUserJid('romeo@example.net')).toBe(true)
  })

  it('accepts a jid with a resource', () => {
    expect(isValidUserJid('romeo@example.net/phone')).toBe(true)
  })

  it('rejects a domain-only jid', () => {
    expect(isValidUserJid('example.net')).toBe(false)
  })

  it('rejects a missing domain', () => {
    expect(isValidUserJid('romeo@')).toBe(false)
  })

  it('rejects an empty jid', () => {
    expect(isValidUserJid('')).toBe(false)
  })
})

describe('isValidAnonymousDomain', () => {
  it('accepts a domain-only jid', () => {
    expect(isValidAnonymousDomain('example.net')).toBe(true)
  })

  it('accepts a dev domain without a dot', () => {
    expect(isValidAnonymousDomain('localhost')).toBe(true)
  })

  it('rejects a jid with a local part', () => {
    expect(isValidAnonymousDomain('romeo@example.net')).toBe(false)
  })

  it('rejects empty input', () => {
    expect(isValidAnonymousDomain('')).toBe(false)
  })
})
