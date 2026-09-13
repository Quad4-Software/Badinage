// XEP-0392 consistent color generation, version 1.0.x. The hue comes
// from a SHA-1 of the bare input so every client renders the same color
// for a given jid or nickname. RGB conversion goes through the HSLuv
// color space (public domain reference algorithm) because its perceptual
// uniformity keeps chroma even across hues where plain HSL would not.

import { sha1Digest } from '$lib/utils/protocol/sha1'

// The first two digest bytes form a little-endian uint16 scaled to a
// degree value. Little-endian, not big-endian: the XEP test vectors only
// line up when byte 0 is the least significant byte.
export function colorAngle(text: string): number {
  const digest = sha1Digest(new TextEncoder().encode(text))
  const value = (digest[0] ?? 0) | ((digest[1] ?? 0) << 8)
  return (value / 65536) * 360
}

// Callers feeding oklch or another hue-driven space want just the angle
export function consistentHue(text: string): number {
  return colorAngle(text)
}

// sRGB transformation matrix from the HSLuv specification
const M: readonly (readonly [number, number, number])[] = [
  [3.240969941904521, -1.537383177570093, -0.498610760293],
  [-0.96924363628087, 1.87596750150772, 0.041555057407175],
  [0.055630079696993, -0.20397695888897, 1.056971514242878]
]
const KAPPA = 903.2962962
const EPSILON = 0.0088564516
const REF_U = 0.19783000664283
const REF_V = 0.46831999493879

interface Bound {
  slope: number
  intercept: number
}

// Six lines in the CIELUV chroma plane bounding the gamut at lightness l
function getBounds(l: number): Bound[] {
  const sub1 = Math.pow(l + 16, 3) / 1560896
  const sub2 = sub1 > EPSILON ? sub1 : l / KAPPA
  const bounds: Bound[] = []
  for (const [m1, m2, m3] of M) {
    for (const t of [0, 1]) {
      const top1 = (284517 * m1 - 94839 * m3) * sub2
      const top2 = (838422 * m3 + 769860 * m2 + 731718 * m1) * l * sub2 - 769860 * t * l
      const bottom = (632260 * m3 - 126452 * m2) * sub2 + 126452 * t
      bounds.push({ slope: top1 / bottom, intercept: top2 / bottom })
    }
  }
  return bounds
}

// longest chroma ray at hue h that stays inside every bound line
function maxChromaForLH(l: number, h: number): number {
  const hrad = (h / 360) * Math.PI * 2
  const sin = Math.sin(hrad)
  const cos = Math.cos(hrad)
  let min = Number.MAX_VALUE
  for (const bound of getBounds(l)) {
    const length = bound.intercept / (sin - bound.slope * cos)
    // a negative length means the line lies behind the ray and cannot bound it
    if (length >= 0) min = Math.min(min, length)
  }
  return min
}

function lToY(l: number): number {
  if (l <= 8) return l / KAPPA
  return Math.pow((l + 16) / 116, 3)
}

function fromLinear(c: number): number {
  if (c <= 0.0031308) return 12.92 * c
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

export function hsluvToRgb(h: number, s: number, l: number): [number, number, number] {
  // snap the extremes so float noise cannot push past solid white or black
  if (l >= 100) return [1, 1, 1]
  if (l <= 0) return [0, 0, 0]
  const c = (maxChromaForLH(l, h) / 100) * s
  const hrad = (h / 360) * Math.PI * 2
  const u = Math.cos(hrad) * c
  const v = Math.sin(hrad) * c
  const varU = u / (13 * l) + REF_U
  const varV = v / (13 * l) + REF_V
  const y = lToY(l)
  const x = -(9 * y * varU) / ((varU - 4) * varV - varU * varV)
  const z = (9 * y - 15 * varV * y - varV * x) / (3 * varV)
  const [r, g, b] = M.map(([m1, m2, m3]) => fromLinear(m1 * x + m2 * y + m3 * z)) as [
    number,
    number,
    number
  ]
  return [r, g, b]
}

export interface ConsistentColorOptions {
  saturation?: number
  lightness?: number
}

// s=90 l=55 keeps enough contrast against both light and dark chat
// backgrounds; s=100 l=50 from the XEP vectors reads too harsh on light
export function consistentColor(text: string, options?: ConsistentColorOptions): string {
  const s = options?.saturation ?? 90
  const l = options?.lightness ?? 55
  const to255 = (c: number): number => Math.round(Math.min(1, Math.max(0, c)) * 255)
  const [r, g, b] = hsluvToRgb(colorAngle(text), s, l)
  return `rgb(${to255(r)} ${to255(g)} ${to255(b)})`
}
