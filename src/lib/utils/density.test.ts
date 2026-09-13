import { describe, expect, it } from 'vitest'

import { DENSITIES, DENSITY_SCALE, normalizeDensity } from './density'

describe('normalizeDensity', () => {
  it('passes through known densities', () => {
    for (const density of DENSITIES) {
      expect(normalizeDensity(density)).toBe(density)
    }
  })

  it('falls back to comfortable on unknown persisted values', () => {
    expect(normalizeDensity('huge')).toBe('comfortable')
    expect(normalizeDensity(undefined)).toBe('comfortable')
    expect(normalizeDensity(42)).toBe('comfortable')
  })
})

describe('DENSITY_SCALE', () => {
  it('covers every density', () => {
    for (const density of DENSITIES) expect(DENSITY_SCALE[density]).toBeDefined()
  })

  it('compact tightens spacing and type without shrinking either to zero', () => {
    expect(DENSITY_SCALE.compact.space).toBeLessThan(DENSITY_SCALE.comfortable.space)
    expect(DENSITY_SCALE.compact.font).toBeLessThan(DENSITY_SCALE.comfortable.font)
    expect(DENSITY_SCALE.compact.space).toBeGreaterThan(0.5)
    expect(DENSITY_SCALE.compact.font).toBeGreaterThan(0.8)
  })
})
