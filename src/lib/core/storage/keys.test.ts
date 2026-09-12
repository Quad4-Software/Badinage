import { describe, expect, it } from 'vitest'

import { globalKey, scopedKey } from './keys'

describe('scopedKey', () => {
  it('namespaces keys by bare jid', () => {
    expect(scopedKey('romeo@example.net/phone', 'msgs', 'peer')).toBe(
      'badinage:romeo@example.net:msgs:peer'
    )
  })

  it('keeps accounts isolated', () => {
    expect(scopedKey('a@x.org', 'k')).not.toBe(scopedKey('b@x.org', 'k'))
  })
})

describe('globalKey', () => {
  it('prefixes app-global keys', () => {
    expect(globalKey('settings')).toBe('badinage:settings')
  })
})
