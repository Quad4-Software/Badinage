import { describe, expect, it } from 'vitest'

import { chatNotifyMode, coalesced, isLiveIncoming, shouldNotify, snippet } from './notify'

describe('isLiveIncoming', () => {
  it('accepts a plain live incoming stanza', () => {
    expect(isLiveIncoming({}, false)).toBe(true)
  })

  it('rejects our own traffic and sent carbons', () => {
    expect(isLiveIncoming({}, true)).toBe(false)
    expect(isLiveIncoming({ delay: undefined }, true)).toBe(false)
  })

  it('rejects archive rows and delayed offline delivery', () => {
    expect(isLiveIncoming({ mam: true }, false)).toBe(false)
    expect(isLiveIncoming({ delay: 1000 }, false)).toBe(false)
  })
})

describe('shouldNotify', () => {
  const base = {
    enabled: true,
    accountEnabled: true,
    permission: 'granted' as const,
    hidden: true,
    conversationActive: false,
    chatMode: 'always' as const,
    mentioned: false,
    attention: false
  }

  it('fires when the tab is hidden', () => {
    expect(shouldNotify(base)).toBe(true)
  })

  it('fires on a visible tab for an inactive conversation', () => {
    expect(shouldNotify({ ...base, hidden: false, conversationActive: false })).toBe(true)
  })

  it('stays quiet on a visible tab showing that conversation', () => {
    expect(shouldNotify({ ...base, hidden: false, conversationActive: true })).toBe(false)
  })

  it('stays quiet when disabled globally or per account', () => {
    expect(shouldNotify({ ...base, enabled: false })).toBe(false)
    expect(shouldNotify({ ...base, accountEnabled: false })).toBe(false)
  })

  it('stays quiet without granted permission', () => {
    for (const permission of ['denied', 'default', 'unsupported'] as const) {
      expect(shouldNotify({ ...base, permission })).toBe(false)
    }
  })

  it('never mode silences even mentions and attention', () => {
    expect(shouldNotify({ ...base, chatMode: 'never', mentioned: true })).toBe(false)
    expect(shouldNotify({ ...base, chatMode: 'never', attention: true })).toBe(false)
  })

  it('on-mention requires a mention unless the sender buzzed', () => {
    expect(shouldNotify({ ...base, chatMode: 'on-mention' })).toBe(false)
    expect(shouldNotify({ ...base, chatMode: 'on-mention', mentioned: true })).toBe(true)
    expect(shouldNotify({ ...base, chatMode: 'on-mention', attention: true })).toBe(true)
  })

  it('attention bypasses the active-conversation gate', () => {
    expect(
      shouldNotify({ ...base, hidden: false, conversationActive: true, attention: true })
    ).toBe(true)
  })
})

describe('chatNotifyMode', () => {
  it('honours the explicit override', () => {
    expect(chatNotifyMode('never', 'dm')).toBe('never')
    expect(chatNotifyMode('always', 'muc')).toBe('always')
  })

  it('defaults dm to always and muc to on-mention', () => {
    expect(chatNotifyMode(undefined, 'dm')).toBe('always')
    expect(chatNotifyMode(undefined, 'muc')).toBe('on-mention')
  })
})

describe('coalesced', () => {
  it('allows the first notification', () => {
    expect(coalesced(undefined, 1000, 4000)).toBe(true)
  })

  it('suppresses repeats inside the window and allows after', () => {
    expect(coalesced(1000, 4999, 4000)).toBe(false)
    expect(coalesced(1000, 5000, 4000)).toBe(true)
  })
})

describe('snippet', () => {
  it('collapses whitespace and trims', () => {
    expect(snippet('  hello\n  world\t ')).toBe('hello world')
  })

  it('cuts long bodies with an ellipsis', () => {
    const out = snippet('x'.repeat(200), 80)
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out.endsWith('…')).toBe(true)
  })
})
