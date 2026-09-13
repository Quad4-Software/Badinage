// Self-contained SHA-1 (RFC 3174). The app needs synchronous hashing for
// the XEP-0115 caps verification string and XEP-0153 avatar photo keys,
// where WebCrypto would force an async api and @noble/hashes is not an app
// dependency. Unit tested against known-answer vectors.

function rotl(n: number, bits: number): number {
  return (n << bits) | (n >>> (32 - bits))
}

function sha1(data: Uint8Array): Uint8Array {
  // padded message length: data + 0x80 + zeros + 64-bit bit length
  const bitLen = data.length * 8
  const total = Math.ceil((data.length + 9) / 64) * 64
  const msg = new Uint8Array(total)
  msg.set(data)
  msg[data.length] = 0x80
  const view = new DataView(msg.buffer)
  // bit lengths above 2^32 are out of scope for stanzas and avatars
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(total - 4, bitLen >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const w = new Int32Array(80)
  for (let block = 0; block < total; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(block + i * 4)
    for (let i = 16; i < 80; i++) {
      w[i] = rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const tmp = (rotl(a, 5) + f + e + k + (w[i] ?? 0)) | 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = tmp
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }

  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  for (const [i, h] of [h0, h1, h2, h3, h4].entries()) outView.setUint32(i * 4, h >>> 0)
  return out
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64_ALPHABET.charAt(b0 >> 2)
    out += B64_ALPHABET.charAt(((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4))
    out +=
      b1 === undefined
        ? '='
        : B64_ALPHABET.charAt(((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6))
    out += b2 === undefined ? '=' : B64_ALPHABET.charAt(b2 & 63)
  }
  return out
}

// base64 decode tolerating the whitespace and stray characters that show
// up in vcard-temp BINVAL payloads; returns null on malformed input
export function base64ToBytes(b64: string): Uint8Array | null {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '')
  if (clean.length % 4 !== 0) return null
  const out: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean.charCodeAt(i)
    const c1 = clean.charCodeAt(i + 1)
    const c2 = clean.charCodeAt(i + 2)
    const c3 = clean.charCodeAt(i + 3)
    const v = (ch: number): number =>
      ch === 61 ? 0 : B64_ALPHABET.indexOf(String.fromCharCode(ch))
    const n0 = v(c0)
    const n1 = v(c1)
    const n2 = v(c2)
    const n3 = v(c3)
    if (n0 < 0 || n1 < 0 || n2 < 0 || n3 < 0) return null
    out.push((n0 << 2) | (n1 >> 4))
    if (c2 !== 61) out.push(((n1 & 15) << 4) | (n2 >> 2))
    if (c3 !== 61) out.push(((n2 & 3) << 6) | n3)
  }
  return new Uint8Array(out)
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function sha1Hex(data: Uint8Array): string {
  return bytesToHex(sha1(data))
}

// raw digest for callers that need bytes rather than hex, like the
// XEP-0392 color angle which reads the first two digest bytes
export function sha1Digest(data: Uint8Array): Uint8Array {
  return sha1(data)
}

function sha1Base64(data: Uint8Array): string {
  return bytesToBase64(sha1(data))
}

export function sha1Base64Utf8(text: string): string {
  return sha1Base64(new TextEncoder().encode(text))
}
