import { describe, expect, it } from 'vitest'

import { ACCOUNT_HUES } from '$lib/constants'

import { autoHue, effectiveHue, nextAccountHue } from './account'

describe('autoHue', () => {
  it('is deterministic and stays inside the palette', () => {
    for (const jid of ['a@x.org', 'b@y.org', 'a@x.org', 'room@conf.z.org']) {
      const hue = autoHue(jid)
      expect(ACCOUNT_HUES).toContain(hue)
      expect(autoHue(jid)).toBe(hue)
    }
  })
})

describe('effectiveHue', () => {
  it('prefers the user pick and falls back to the jid hash', () => {
    expect(effectiveHue({ hue: 55 }, 'a@x.org')).toBe(55)
    expect(effectiveHue(undefined, 'a@x.org')).toBe(autoHue('a@x.org'))
    expect(effectiveHue({}, 'a@x.org')).toBe(autoHue('a@x.org'))
  })
})

describe('nextAccountHue', () => {
  it('cycles auto -> each palette hue -> auto', () => {
    let hue = nextAccountHue(undefined)
    const seen: number[] = []
    while (hue !== undefined) {
      expect(ACCOUNT_HUES).toContain(hue)
      expect(seen).not.toContain(hue)
      seen.push(hue)
      hue = nextAccountHue(hue)
    }
    expect(seen).toEqual([...ACCOUNT_HUES])
  })

  it('starts over when the stored hue is off-palette', () => {
    expect(nextAccountHue(999)).toBe(ACCOUNT_HUES[0])
  })
})
