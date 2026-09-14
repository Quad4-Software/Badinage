import { describe, expect, it } from 'vitest'

import {
  defaultISupport,
  isChannelTarget,
  jidToTarget,
  JOIN_ERROR_CONDITIONS,
  parseIsupport,
  prefixToRole,
  targetToJid
} from '../address'

describe('targetToJid / jidToTarget', () => {
  const isupport = defaultISupport()

  it('maps channels and nicks to synthetic bare jids', () => {
    expect(targetToJid('#chan', 'irc.example.org', isupport)).toBe('#chan@irc.example.org')
    expect(targetToJid('Nick', 'irc.example.org', isupport)).toBe('nick@irc.example.org')
  })

  it('round-trips through jidToTarget', () => {
    expect(jidToTarget('#chan@irc.example.org')).toBe('#chan')
    expect(jidToTarget('nick@irc.example.org')).toBe('nick')
  })

  it('folds nicks under the network casemapping', () => {
    expect(targetToJid('Ni[k]e', 'd', isupport)).toBe('ni{k}e@d')
    const ascii = { ...isupport, casemapping: 'ascii' as const }
    expect(targetToJid('Ni[k]e', 'd', ascii)).toBe('ni[k]e@d')
  })
})

describe('isChannelTarget', () => {
  it('follows CHANTYPES', () => {
    const isupport = defaultISupport()
    expect(isChannelTarget('#a', isupport)).toBe(true)
    expect(isChannelTarget('&a', isupport)).toBe(true)
    expect(isChannelTarget('nick', isupport)).toBe(false)
    parseIsupport(isupport, ['CHANTYPES=#'])
    expect(isChannelTarget('&a', isupport)).toBe(false)
  })
})

describe('parseIsupport', () => {
  it('reads PREFIX and CASEMAPPING', () => {
    const isupport = defaultISupport()
    parseIsupport(isupport, ['PREFIX=(qaohv)~&@%+', 'CASEMAPPING=ascii'])
    expect(isupport.prefixModes).toBe('qaohv')
    expect(isupport.prefixChars).toBe('~&@%+')
    expect(isupport.casemapping).toBe('ascii')
  })

  it('reads numeric limits and network name', () => {
    const isupport = defaultISupport()
    parseIsupport(isupport, ['MONITOR=100', 'CHATHISTORY=500', 'NETWORK=TestNet'])
    expect(isupport.monitor).toBe(100)
    expect(isupport.chathistory).toBe(500)
    expect(isupport.network).toBe('TestNet')
  })
})

describe('prefixToRole', () => {
  it('maps the strongest prefix to an affiliation', () => {
    const isupport = defaultISupport()
    expect(prefixToRole('@', isupport)).toEqual({ affiliation: 'admin', role: 'moderator' })
    expect(prefixToRole('+', isupport)).toEqual({ affiliation: 'member', role: 'participant' })
    expect(prefixToRole('@+', isupport)).toEqual({ affiliation: 'admin', role: 'moderator' })
    expect(prefixToRole('', isupport)).toEqual({ affiliation: 'member', role: 'participant' })
  })

  it('honours extended prefix modes', () => {
    const isupport = defaultISupport()
    parseIsupport(isupport, ['PREFIX=(qaohv)~&@%+'])
    expect(prefixToRole('~', isupport)).toEqual({ affiliation: 'owner', role: 'moderator' })
    expect(prefixToRole('&', isupport)).toEqual({ affiliation: 'admin', role: 'moderator' })
    expect(prefixToRole('%', isupport)).toEqual({ affiliation: 'member', role: 'moderator' })
  })
})

describe('JOIN_ERROR_CONDITIONS', () => {
  it('covers the common join failures', () => {
    expect(JOIN_ERROR_CONDITIONS['475']).toBe('not-authorized')
    expect(JOIN_ERROR_CONDITIONS['473']).toBe('registration-required')
    expect(JOIN_ERROR_CONDITIONS['403']).toBe('item-not-found')
  })
})
