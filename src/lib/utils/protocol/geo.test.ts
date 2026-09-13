import { describe, expect, it } from 'vitest'

import { geoUri, isGeoUri, osmUrl, tileFor, tileUrl } from '$lib/utils/protocol/geo'

describe('geoUri', () => {
  it('formats a geo uri with at most 6 decimals', () => {
    expect(geoUri(52.52, 13.405)).toBe('geo:52.52,13.405')
    expect(geoUri(52.123456789, 13.4)).toBe('geo:52.123457,13.4')
  })

  it('normalizes negative zero after rounding', () => {
    expect(geoUri(0, -0.0000004)).toBe('geo:0,0')
  })
})

describe('tileFor', () => {
  it('puts the origin at the tile center on zoom 0', () => {
    expect(tileFor(0, 0, 0)).toEqual({ x: 0, y: 0, pinX: 128, pinY: 128 })
  })

  it('puts the origin on the shared tile corner on zoom 1', () => {
    // lon 0 lat 0 is the center of the whole grid, which at z1 is the
    // corner shared by all four tiles; the containing tile owns it at 0,0
    expect(tileFor(0, 0, 1)).toEqual({ x: 1, y: 1, pinX: 0, pinY: 0 })
  })

  it('centers the pin when the point falls mid tile', () => {
    expect(tileFor(0, 90, 1)).toEqual({ x: 1, y: 1, pinX: 128, pinY: 0 })
  })

  it('matches a reference computation for Berlin at z15', () => {
    expect(tileFor(52.52, 13.405, 15)).toEqual({ x: 17604, y: 10746, pinX: 39, pinY: 111 })
  })

  it('matches a reference computation for Hamburg at z12', () => {
    expect(tileFor(53.55, 10, 12)).toEqual({ x: 2161, y: 1323, pinX: 199, pinY: 208 })
  })

  it('clamps out of range coordinates into the grid', () => {
    const n = 2 ** 5
    const sw = tileFor(-90, -200, 5)
    expect(sw.x).toBe(0)
    expect(sw.y).toBe(n - 1)
    const ne = tileFor(90, 200, 5)
    expect(ne.x).toBe(n - 1)
    expect(ne.y).toBe(0)
    for (const t of [sw, ne]) {
      expect(t.pinX).toBeGreaterThanOrEqual(0)
      expect(t.pinX).toBeLessThanOrEqual(255)
      expect(t.pinY).toBeGreaterThanOrEqual(0)
      expect(t.pinY).toBeLessThanOrEqual(255)
    }
  })
})

describe('tileUrl', () => {
  const template = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

  it('substitutes all placeholders', () => {
    expect(tileUrl(template, 52.52, 13.405, 15)).toBe(
      'https://tile.openstreetmap.org/15/17604/10746.png'
    )
  })

  it('returns empty for out of range coordinates', () => {
    expect(tileUrl(template, 91, 0, 5)).toBe('')
    expect(tileUrl(template, 0, 181, 5)).toBe('')
    expect(tileUrl(template, Number.NaN, 0, 5)).toBe('')
  })

  it('returns empty when the template lacks a placeholder', () => {
    expect(tileUrl('https://tiles.example/{z}/{x}.png', 0, 0, 5)).toBe('')
    expect(tileUrl('https://tiles.example/fixed.png', 0, 0, 5)).toBe('')
  })
})

describe('osmUrl', () => {
  it('builds an openstreetmap marker link at zoom 17', () => {
    expect(osmUrl(52.52, 13.405)).toBe(
      'https://www.openstreetmap.org/?mlat=52.52&mlon=13.405#map=17/52.52/13.405'
    )
  })
})

describe('isGeoUri', () => {
  it('accepts geo uris with and without parameters', () => {
    expect(isGeoUri('geo:51.5,-0.12')).toBe(true)
    expect(isGeoUri('geo:1,2;u=35')).toBe(true)
    expect(isGeoUri('GEO:0,0')).toBe(true)
    expect(isGeoUri('  geo:1,2  ')).toBe(true)
  })

  it('rejects non-geo text', () => {
    expect(isGeoUri('')).toBe(false)
    expect(isGeoUri('geo:')).toBe(false)
    expect(isGeoUri('geo:abc')).toBe(false)
    expect(isGeoUri('see geo:1,2 here')).toBe(false)
    expect(isGeoUri('https://example.com/geo:1,2')).toBe(false)
  })
})
