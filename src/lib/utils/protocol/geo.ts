// Slippy-map tile math for XEP-0080 geoloc previews. The helpers stay
// pure so the ui can render a tile with a pin without a map library.
// Web mercator only covers latitudes within about 85.05 degrees, so
// tileFor clamps there instead of returning nonsense near the poles.

const TILE_SIZE = 256
// latitude where the mercator projection leaves the square tile grid
const MAX_LAT = 85.0511287798

function round6(n: number): number {
  const r = Math.round(n * 1e6) / 1e6
  // -0 would print as "-0" in a uri, normalize to a plain zero
  return r === 0 ? 0 : r
}

export function geoUri(lat: number, lon: number): string {
  return `geo:${round6(lat)},${round6(lon)}`
}

// Does a message body look like a bare geo uri fallback? Senders put it
// there for clients without XEP-0080 support; when the stanza also
// carries a parsed geoloc the raw uri adds nothing.
export function isGeoUri(text: string): boolean {
  return /^geo:[+-]?\d+(\.\d+)?,[+-]?\d+(\.\d+)?([;,][^\s]*)?$/i.test(text.trim())
}

export interface TilePosition {
  x: number
  y: number
  // pixel offset of the exact point inside the tile, 0 to 255
  pinX: number
  pinY: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function tileFor(lat: number, lon: number, z: number): TilePosition {
  const n = 2 ** z
  const clat = clamp(lat, -MAX_LAT, MAX_LAT)
  const clon = clamp(lon, -180, 180)
  const xf = ((clon + 180) / 360) * n
  const latRad = (clat * Math.PI) / 180
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const x = clamp(Math.floor(xf), 0, n - 1)
  const y = clamp(Math.floor(yf), 0, n - 1)
  // measure the point against the clamped tile so edge pixels stay sane
  const pinX = clamp(Math.floor((xf - x) * TILE_SIZE), 0, TILE_SIZE - 1)
  const pinY = clamp(Math.floor((yf - y) * TILE_SIZE), 0, TILE_SIZE - 1)
  return { x, y, pinX, pinY }
}

export function tileUrl(template: string, lat: number, lon: number, z: number): string {
  // a url is useless when the coordinate cannot be placed on a tile
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return ''
  }
  // every placeholder must be present, a partial template silently
  // renders the wrong tile and that failure is worse than no preview
  if (!template.includes('{z}') || !template.includes('{x}') || !template.includes('{y}')) {
    return ''
  }
  const { x, y } = tileFor(lat, lon, z)
  return template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
}

export function osmUrl(lat: number, lon: number): string {
  const la = round6(lat)
  const lo = round6(lon)
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`
}
