import { afterEach, describe, expect, it, vi } from 'vitest'

import { AESGCM_IV_BYTES, AESGCM_KEY_BYTES } from '$lib/constants'

import {
  aesGcmSize,
  buildAesGcmUrl,
  decryptAesGcm,
  encryptAesGcm,
  fetchAesGcm,
  isAesGcmUrl,
  parseAesGcmUrl,
  primeAesGcm
} from './aesgcm'

const VALID_URL =
  'aesgcm://files.example.net/abcd' +
  '#' +
  'aa'.repeat(AESGCM_IV_BYTES) +
  'bb'.repeat(AESGCM_KEY_BYTES)

describe('isAesGcmUrl', () => {
  it('accepts the aesgcm scheme case insensitively', () => {
    expect(isAesGcmUrl(VALID_URL)).toBe(true)
    expect(isAesGcmUrl('  AESGCM://x.y/z#ff')).toBe(true)
    expect(isAesGcmUrl('https://x.y/z')).toBe(false)
  })
})

describe('parseAesGcmUrl', () => {
  it('splits a valid url into download url, iv and key', () => {
    const link = parseAesGcmUrl(VALID_URL)
    expect(link).not.toBeNull()
    expect(link?.downloadUrl).toBe('https://files.example.net/abcd')
    expect(link?.iv).toHaveLength(AESGCM_IV_BYTES)
    expect(link?.iv[0]).toBe(0xaa)
    expect(link?.key).toHaveLength(AESGCM_KEY_BYTES)
    expect(link?.key[0]).toBe(0xbb)
  })

  it('rejects malformed urls', () => {
    expect(parseAesGcmUrl('https://files.example.net/abcd#aa')).toBeNull()
    expect(parseAesGcmUrl('aesgcm://files.example.net/abcd')).toBeNull()
    expect(parseAesGcmUrl('aesgcm://files.example.net/abcd#zz')).toBeNull()
    // fragment shorter or longer than iv + key
    expect(parseAesGcmUrl(`aesgcm://files.example.net/abcd#${'aa'.repeat(10)}`)).toBeNull()
    expect(
      parseAesGcmUrl(
        `aesgcm://files.example.net/abcd#${'aa'.repeat(AESGCM_IV_BYTES + AESGCM_KEY_BYTES + 1)}`
      )
    ).toBeNull()
  })

  it('rejects non-https download urls', () => {
    // aesgcm://host normalizes to https:. An explicit http port is fine,
    // a bogus host is not
    expect(
      parseAesGcmUrl(`aesgcm:///#${'aa'.repeat(AESGCM_IV_BYTES + AESGCM_KEY_BYTES)}`)
    ).toBeNull()
  })
})

describe('buildAesGcmUrl', () => {
  it('embeds hex(iv) followed by hex(key) in the fragment', () => {
    const key = new Uint8Array(AESGCM_KEY_BYTES).fill(0x11)
    const iv = new Uint8Array(AESGCM_IV_BYTES).fill(0x22)
    const url = buildAesGcmUrl('https://files.example.net/x', key, iv)
    expect(url).toBe(`aesgcm://files.example.net/x#${'22'.repeat(12)}${'11'.repeat(32)}`)
    // and round trips through the parser
    const link = parseAesGcmUrl(url ?? '')
    expect(link?.downloadUrl).toBe('https://files.example.net/x')
    expect([...(link?.key ?? [])]).toEqual([...key])
    expect([...(link?.iv ?? [])]).toEqual([...iv])
  })

  it('refuses http and malformed get urls', () => {
    const key = new Uint8Array(AESGCM_KEY_BYTES)
    const iv = new Uint8Array(AESGCM_IV_BYTES)
    expect(buildAesGcmUrl('http://files.example.net/x', key, iv)).toBeNull()
    expect(buildAesGcmUrl('not a url', key, iv)).toBeNull()
    expect(buildAesGcmUrl('https://files.example.net/x', key.slice(1), iv)).toBeNull()
  })
})

describe('encryptAesGcm/decryptAesGcm', () => {
  it('round trips arbitrary bytes', async () => {
    const plaintext = new TextEncoder().encode('secret file contents')
    const { ciphertext, key, iv } = await encryptAesGcm(plaintext)
    expect(ciphertext.length).toBe(plaintext.length + 16)
    const back = await decryptAesGcm(key, iv, ciphertext)
    expect([...back]).toEqual([...plaintext])
  })

  it('fails on tampered ciphertext or wrong key', async () => {
    const { ciphertext, key, iv } = await encryptAesGcm(new Uint8Array([1, 2, 3]))
    const tampered = ciphertext.slice()
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    await expect(decryptAesGcm(key, iv, tampered)).rejects.toThrow('aesgcm')
    const wrongKey = new Uint8Array(AESGCM_KEY_BYTES).fill(7)
    await expect(decryptAesGcm(wrongKey, iv, ciphertext)).rejects.toThrow('aesgcm')
  })
})

describe('aesGcmSize', () => {
  it('adds the tag length', () => {
    expect(aesGcmSize(100)).toBe(116)
  })
})

describe('fetchAesGcm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a primed blob without any download', async () => {
    const blob = new Blob(['cached'], { type: 'image/png' })
    primeAesGcm(VALID_URL, blob)
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    const out = await fetchAesGcm(VALID_URL)
    expect(fetched).not.toHaveBeenCalled()
    expect(await out.text()).toBe('cached')
  })

  it('downloads ciphertext and decrypts it', async () => {
    const plaintext = new TextEncoder().encode('wire bytes')
    const { ciphertext, key, iv } = await encryptAesGcm(plaintext)
    const url = buildAesGcmUrl('https://files.example.net/f', key, iv)
    expect(url).not.toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(ciphertext as unknown as BodyInit))
    )
    const blob = await fetchAesGcm(url ?? '')
    expect(await blob.text()).toBe('wire bytes')
  })

  it('throws on download and decrypt failures instead of crashing', async () => {
    const { key, iv } = await encryptAesGcm(new Uint8Array([9]))
    const url = buildAesGcmUrl('https://files.example.net/f', key, iv) ?? ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    )
    await expect(fetchAesGcm(url)).rejects.toThrow('aesgcm')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('short'))
    )
    await expect(fetchAesGcm(url)).rejects.toThrow('aesgcm')
  })

  it('throws on malformed urls before touching the network', async () => {
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    await expect(fetchAesGcm('aesgcm://x.y/z#bad')).rejects.toThrow('aesgcm')
    expect(fetched).not.toHaveBeenCalled()
  })
})
