import { describe, expect, it } from 'vitest'

import { bareJid, isValidBareJid, jidDomain, parseJid } from './jid'

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

  it('rejects a jid without a dot in the domain', () => {
    expect(isValidBareJid('romeo@localhost')).toBe(false)
  })

  it('rejects an empty jid', () => {
    expect(isValidBareJid('')).toBe(false)
  })
})
