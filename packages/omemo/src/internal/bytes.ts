// Byte utilities. No Node Buffer and no DOM APIs so this works in browsers,
// workers and Node alike.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1)
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i
  return table
})()

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

export function bytesToHex(data: Uint8Array): string {
  let hex = ''
  for (const byte of data) hex += byte.toString(16).padStart(2, '0')
  return hex
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new Error('invalid hex string')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function bytesToUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data)
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

export function base64Encode(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i] ?? 0
    const b = data[i + 1]
    const c = data[i + 2]
    out += B64_ALPHABET[a >> 2]
    out += B64_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64_ALPHABET[c & 0x3f]
  }
  return out
}

export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s]+/g, '').replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let written = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)] ?? -1
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)] ?? -1
    const c = clean.charCodeAt(i + 2) < 128 ? B64_LOOKUP[clean.charCodeAt(i + 2)] : 0
    const d = clean.charCodeAt(i + 3) < 128 ? B64_LOOKUP[clean.charCodeAt(i + 3)] : 0
    if (a < 0 || b < 0 || (c ?? -1) < 0 || (d ?? -1) < 0) throw new Error('invalid base64')
    const triple = (a << 18) | (b << 12) | ((c ?? 0) << 6) | (d ?? 0)
    if (written < out.length) out[written++] = (triple >> 16) & 0xff
    if (written < out.length) out[written++] = (triple >> 8) & 0xff
    if (written < out.length) out[written++] = triple & 0xff
  }
  return out.subarray(0, written)
}

export function bytesToBigIntLE(data: Uint8Array): bigint {
  let out = 0n
  for (let i = data.length - 1; i >= 0; i--) out = (out << 8n) | BigInt(data[i] ?? 0)
  return out
}

export function bigIntToBytesLE(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let v = value
  for (let i = 0; i < length; i++) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}
