// Generates PNG icons and the OG card for Badinage without native deps.
// Usage: pnpm icons
// Renders the mark (gradient tile + chat bubble + dots) and a bitmap wordmark,
// supersampled 4x then box-downsampled for antialiasing.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const BRAND_TOP = [129, 140, 248]
const BRAND_BOTTOM = [79, 70, 229]
const WHITE = [250, 250, 250]
const DOT = [79, 70, 229]

const SS = 4

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

class Canvas {
  constructor(width, height) {
    this.width = width * SS
    this.height = height * SS
    this.scale = SS
    this.outWidth = width
    this.outHeight = height
    this.px = Buffer.alloc(this.width * this.height * 4)
  }

  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 4
    if (a === 255) {
      this.px[i] = r
      this.px[i + 1] = g
      this.px[i + 2] = b
      this.px[i + 3] = 255
    } else {
      const t = a / 255
      this.px[i] = Math.round(r * t + this.px[i] * (1 - t))
      this.px[i + 1] = Math.round(g * t + this.px[i + 1] * (1 - t))
      this.px[i + 2] = Math.round(b * t + this.px[i + 2] * (1 - t))
      this.px[i + 3] = 255
    }
  }

  fill(fn) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = fn(x / this.scale, y / this.scale)
        if (c) this.set(x, y, c)
      }
    }
  }

  roundedRect(x0, y0, w, h, radius, colorFn) {
    const inRect = (x, y) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h
    const inCorner = (x, y) => {
      const cx = x < x0 + radius ? x0 + radius : x > x0 + w - radius - 1 ? x0 + w - radius - 1 : x
      const cy = y < y0 + radius ? y0 + radius : y > y0 + h - radius - 1 ? y0 + h - radius - 1 : y
      return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
    }
    this.fill((x, y) => (inRect(x, y) && inCorner(x, y) ? colorFn(x, y) : null))
  }

  circle(cx, cy, r, color) {
    this.fill((x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? color : null))
  }

  triangle(x0, y0, x1, y1, x2, y2, color) {
    const minX = Math.min(x0, x1, x2)
    const maxX = Math.max(x0, x1, x2)
    const minY = Math.min(y0, y1, y2)
    const maxY = Math.max(y0, y1, y2)
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    this.fill((x, y) => {
      if (x < minX || x > maxX || y < minY || y > maxY) return null
      const w1 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area
      const w2 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area
      const w3 = 1 - w1 - w2
      return w1 >= 0 && w2 >= 0 && w3 >= 0 ? color : null
    })
  }

  text(str, x0, y0, cell, color) {
    let cx = x0
    for (const ch of str) {
      const glyph = FONT[ch]
      if (glyph) {
        for (let row = 0; row < 7; row++) {
          for (let col = 0; col < 5; col++) {
            if (glyph[row][col] === '1') {
              this.roundedRect(cx + col * cell, y0 + row * cell, cell, cell, 0, () => color)
            }
          }
        }
      }
      cx += 6 * cell
    }
  }

  downsample() {
    const out = Buffer.alloc(this.outWidth * this.outHeight * 4)
    for (let y = 0; y < this.outHeight; y++) {
      for (let x = 0; x < this.outWidth; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const i = ((y * SS + sy) * this.width + x * SS + sx) * 4
            r += this.px[i]
            g += this.px[i + 1]
            b += this.px[i + 2]
            a += this.px[i + 3]
          }
        }
        const n = SS * SS
        const o = (y * this.outWidth + x) * 4
        out[o] = r / n
        out[o + 1] = g / n
        out[o + 2] = b / n
        out[o + 3] = a / n
      }
    }
    return out
  }

  png() {
    return encodePng(this.outWidth, this.outHeight, this.downsample())
  }
}

function gradient(size) {
  return (_x, y) => {
    const t = Math.min(1, Math.max(0, y / size))
    return [
      Math.round(BRAND_TOP[0] + (BRAND_BOTTOM[0] - BRAND_TOP[0]) * t),
      Math.round(BRAND_TOP[1] + (BRAND_BOTTOM[1] - BRAND_TOP[1]) * t),
      Math.round(BRAND_TOP[2] + (BRAND_BOTTOM[2] - BRAND_TOP[2]) * t)
    ]
  }
}

function drawMark(canvas, size, pad = 0, ox = 0, oy = 0) {
  const tile = size - pad * 2
  canvas.roundedRect(ox + pad, oy + pad, tile, tile, tile * 0.22, gradient(tile))
  const bx = ox + pad + tile * 0.22
  const by = oy + pad + tile * 0.25
  const bw = tile * 0.56
  const bh = tile * 0.375
  const br = tile * 0.09
  canvas.roundedRect(bx, by, bw, bh, br, () => WHITE)
  canvas.triangle(
    bx + bw * 0.28,
    by + bh,
    bx + bw * 0.28,
    by + bh + tile * 0.16,
    bx + bw * 0.45,
    by + bh,
    WHITE
  )
  const dotR = tile * 0.05
  const dotY = by + bh / 2
  for (const fx of [0.25, 0.5, 0.75]) {
    canvas.circle(bx + bw * fx, dotY, dotR, DOT)
  }
}

const FONT = {
  b: ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
  a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  d: ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  n: ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
  g: ['00000', '01111', '10001', '10001', '01111', '00001', '11110'],
  e: ['00000', '00000', '01110', '10001', '11111', '10000', '01110']
}

for (const size of [32, 180, 192, 512]) {
  const c = new Canvas(size, size)
  drawMark(c, size)
  const name =
    size === 180 ? 'apple-touch-icon.png' : size === 32 ? 'favicon-32.png' : `icon-${size}.png`
  writeFileSync(path.join(outDir, name), c.png())
}

{
  const size = 512
  const pad = Math.round(size * 0.2)
  const c = new Canvas(size, size)
  drawMark(c, size, pad)
  writeFileSync(path.join(outDir, 'icon-512-maskable.png'), c.png())
}

{
  const c = new Canvas(1200, 630)
  c.fill(() => [24, 24, 27])
  const markSize = 300
  const cell = 8
  const word = 'badinage'
  const wordWidth = word.length * 6 * cell
  const mx = (1200 - markSize - 48 - wordWidth) / 2
  const my = (630 - markSize) / 2
  drawMark(c, markSize, 0, mx, my)
  c.text(word, mx + markSize + 48, my + markSize / 2 - (7 * cell) / 2, cell, WHITE)
  writeFileSync(path.join(root, 'public', 'og.png'), c.png())
}

console.log('icons written to public/icons and public/og.png')
