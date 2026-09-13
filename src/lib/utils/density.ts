// UI density scale. The setting lands on data-density on the root element
// and app.css mirrors these multipliers into the density css tokens;
// spacing shrinks faster than type so compact stays readable and keeps
// interactive elements above the minimum target size.

export const DENSITIES = ['comfortable', 'compact'] as const
export type Density = (typeof DENSITIES)[number]

// persisted blobs from older builds may carry anything; unknown values
// fall back to comfortable
export function normalizeDensity(value: unknown): Density {
  return value === 'compact' ? 'compact' : 'comfortable'
}

export const DENSITY_SCALE: Record<Density, { space: number; font: number }> = {
  comfortable: { space: 1, font: 1 },
  compact: { space: 0.7, font: 0.92 }
}
