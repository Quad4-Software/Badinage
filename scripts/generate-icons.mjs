// Generates PNG icons, favicon.svg and the OG card for Badinage without
// native deps. Usage: pnpm icons
// The mark is 16x16 pixel art (speech bubble with a knockout heart) drawn on
// a logical grid and scaled with nearest neighbor: crisp pixels, no
// antialiasing. The OG card adds a bitmap wordmark in the same spirit.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const TILE = [79, 70, 229] // #4f46e5
const BUBBLE = [238, 242, 255] // #eef2ff
const INK = [24, 24, 27] // og background
const WHITE = [250, 250, 250]

const SS = 1 // no supersampling: the mark must stay crisp

const GRID = 16
// B = bubble, H = heart (knockout to tile color)
const MARK = [
  '................',
  '................',
  '....BBBBBBBB....',
  '..BBBBBBBBBBBB..',
  '.BBBBHHBHHBBBBB.',
  '.BBBHHHHHHHBBBB.',
  '.BBBHHHHHHHBBBB.',
  '.BBBBHHHHHBBBBB.',
  '.BBBBBHHHBBBBBB.',
  '.BBBBBBHBBBBBBB.',
  '..BBBBBBBBBBBB..',
  '..BBBBB.........',
  '..BBBB..........',
  '..BBB...........',
  '..BB............',
  '................'
]

const MARK_COLORS = { B: BUBBLE, H: TILE }

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

  rect(x0, y0, w, h, color) {
    this.fill((x, y) => (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h ? color : null))
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

  // Nearest-neighbor blit of a character mask onto the canvas. Each output
  // pixel maps to exactly one mask cell, so edges stay hard even when the
  // cell size is fractional.
  blit(mask, gx, gy, cell, colors) {
    const rows = mask.length
    const cols = mask[0].length
    this.fill((x, y) => {
      const cx = Math.floor((x - gx) / cell)
      const cy = Math.floor((y - gy) / cell)
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null
      return colors[mask[cy][cx]] || null
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
              this.rect(cx + col * cell, y0 + row * cell, cell, cell, color)
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

// Draws the mark at (x, y) in a size x size box. The tile always fills the
// box; glyphScale < 1 shrinks the bubble+heart inside it, used to keep the
// maskable icon glyph inside the safe zone.
function drawMark(canvas, x, y, size, glyphScale = 1) {
  canvas.rect(x, y, size, size, TILE)
  const cell = (size / GRID) * glyphScale
  const off = (size - GRID * cell) / 2
  canvas.blit(MARK, x + off, y + off, cell, MARK_COLORS)
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
  drawMark(c, 0, 0, size)
  const name =
    size === 180 ? 'apple-touch-icon.png' : size === 32 ? 'favicon-32.png' : `icon-${size}.png`
  writeFileSync(path.join(outDir, name), c.png())
}

{
  const size = 512
  const c = new Canvas(size, size)
  drawMark(c, 0, 0, size, 0.62)
  writeFileSync(path.join(outDir, 'icon-512-maskable.png'), c.png())
}

{
  const c = new Canvas(1200, 630)
  c.fill(() => INK)
  const markSize = 320 // 20 device px per logical pixel, perfectly even
  const cell = 8
  const word = 'badinage'
  const wordWidth = word.length * 6 * cell
  const mx = (1200 - markSize - 48 - wordWidth) / 2
  const my = (630 - markSize) / 2
  drawMark(c, mx, my, markSize)
  c.text(word, mx + markSize + 48, my + markSize / 2 - (7 * cell) / 2, cell, WHITE)
  writeFileSync(path.join(root, 'public', 'og.png'), c.png())
}

// favicon.svg: the same 16x16 mark as crisp-edged SVG rects, one horizontal
// run per path segment.
function maskPath(ch) {
  let d = ''
  MARK.forEach((row, y) => {
    let x = 0
    while (x < GRID) {
      if (row[x] === ch) {
        let x2 = x
        while (x2 < GRID && row[x2] === ch) x2++
        d += `M${x} ${y}h${x2 - x}v1h-${x2 - x}z`
        x = x2
      } else {
        x++
      }
    }
  })
  return d
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
  <rect width="16" height="16" fill="#4f46e5"/>
  <path d="${maskPath('B')}" fill="#eef2ff"/>
  <path d="${maskPath('H')}" fill="#4f46e5"/>
</svg>
`
writeFileSync(path.join(root, 'public', 'favicon.svg'), svg)

console.log('icons written to public/icons, public/favicon.svg and public/og.png')
