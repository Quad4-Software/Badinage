import { describe, expect, it } from 'vitest'

import { colorAngle, consistentColor, consistentHue, hsluvToRgb } from '$lib/utils/protocol/color'

describe('colorAngle', () => {
  // XEP-0392 version 1.0.x test vectors
  it.each([
    ['Romeo', 327.255249],
    ['juliet@capulet.lit', 209.4104],
    ['\u{1f63a}', 331.199341],
    ['council', 359.994507],
    ['Board', 171.430664]
  ])('maps %s to the XEP angle', (input, expected) => {
    expect(colorAngle(input)).toBeCloseTo(expected, 4)
  })

  it('is deterministic', () => {
    expect(colorAngle('romeo@montague.lit')).toBe(colorAngle('romeo@montague.lit'))
  })

  it('keeps consistentHue in sync with colorAngle', () => {
    expect(consistentHue('juliet@capulet.lit')).toBe(colorAngle('juliet@capulet.lit'))
  })
})

describe('hsluvToRgb', () => {
  // XEP-0392 rgb vectors at s=100 l=50, each channel within 0.001
  it.each([
    [327.255249, 0.865, 0.0, 0.686],
    [209.4104, 0.0, 0.515, 0.573],
    [331.199341, 0.872, 0.0, 0.659],
    [359.994507, 0.918, 0.0, 0.394],
    [171.430664, 0.0, 0.527, 0.457]
  ])('maps hue %f to rgb(%f, %f, %f)', (h, r, g, b) => {
    const rgb = hsluvToRgb(h, 100, 50)
    expect(rgb[0]).toBeCloseTo(r, 3)
    expect(rgb[1]).toBeCloseTo(g, 3)
    expect(rgb[2]).toBeCloseTo(b, 3)
  })

  it('snaps extreme lightness to black and white', () => {
    expect(hsluvToRgb(120, 100, 0)).toEqual([0, 0, 0])
    expect(hsluvToRgb(120, 100, 100)).toEqual([1, 1, 1])
  })
})

describe('consistentColor', () => {
  it('returns a css rgb triple with integer channels', () => {
    expect(consistentColor('juliet@capulet.lit')).toMatch(/^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/)
  })

  it('is stable for the same input', () => {
    expect(consistentColor('room@conference.lit')).toBe(consistentColor('room@conference.lit'))
  })

  it('differs for different inputs', () => {
    expect(consistentColor('Romeo')).not.toBe(consistentColor('council'))
  })

  it('honors saturation and lightness overrides', () => {
    const custom = consistentColor('Romeo', { saturation: 100, lightness: 50 })
    const [r, g, b] = hsluvToRgb(327.255249, 100, 50).map((c) => Math.round(c * 255))
    expect(custom).toBe(`rgb(${r} ${g} ${b})`)
  })
})
