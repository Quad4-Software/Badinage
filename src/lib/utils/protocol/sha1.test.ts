import { describe, expect, it } from 'vitest'

import { base64ToBytes, bytesToBase64, bytesToHex, sha1Base64Utf8, sha1Hex } from './sha1'

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('sha1', () => {
  // RFC 3174 appendix A known-answer vectors
  it('hashes the empty message', () => {
    expect(sha1Hex(new Uint8Array())).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })

  it('hashes abc', () => {
    expect(sha1Hex(utf8('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha1Base64Utf8('abc')).toBe('qZk+NkcGgWq6PiVxeFDCbJzQ2J0=')
  })

  it('hashes a multi-block message', () => {
    expect(sha1Hex(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1'
    )
  })

  it('hashes the 448-bit edge case that needs a second padding block', () => {
    const msg = utf8('a'.repeat(56))
    expect(sha1Hex(msg)).toBe('c2db330f6083854c99d4b5bfb6e8f29f201be699')
  })
})

describe('base64 helpers', () => {
  it('round-trips bytes through base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('handles padding lengths', () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=')
    expect(bytesToBase64(new Uint8Array([104]))).toBe('aA==')
    expect(base64ToBytes('aA==')).toEqual(new Uint8Array([104]))
  })

  it('tolerates whitespace in BINVAL-style input', () => {
    expect(base64ToBytes(' aGk=\n')).toEqual(new Uint8Array([104, 105]))
  })

  it('returns null on malformed input', () => {
    expect(base64ToBytes('aGk')).toBeNull()
    // stray characters are stripped by design; only a bad length fails
    expect(base64ToBytes('aGk=')).toEqual(new Uint8Array([104, 105]))
  })

  it('bytesToHex lowercases and zero-pads', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff')
  })
})
