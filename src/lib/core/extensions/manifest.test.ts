import { describe, expect, it } from 'vitest'

import { compareVersions, ManifestError, parsePackage, signedPayload } from './manifest'
import { keyFingerprint, verifyPackage } from './verify'
import type { ExtManifest } from './types'

function manifest(overrides: Partial<ExtManifest> = {}): ExtManifest {
  return {
    id: 'org.example.test',
    name: 'Test',
    version: '1.0.0',
    api: 1,
    permissions: ['menus'],
    connect: [],
    ...overrides
  }
}

function pkg(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ manifest: manifest(), code: 'badinage.log("hi")', ...overrides })
}

describe('parsePackage', () => {
  it('accepts a minimal valid package', () => {
    const p = parsePackage(pkg())
    expect(p.manifest.id).toBe('org.example.test')
    expect(p.signature).toBeUndefined()
  })

  it('rejects non-json and wrong shapes', () => {
    expect(() => parsePackage('nope')).toThrow(ManifestError)
    expect(() => parsePackage('42')).toThrow(ManifestError)
    expect(() => parsePackage('{"manifest":{}}')).toThrow(ManifestError)
  })

  it('rejects bad ids, versions and api levels', () => {
    expect(() => parsePackage(pkg({ manifest: manifest({ id: 'BAD ID' }) }))).toThrow()
    expect(() => parsePackage(pkg({ manifest: manifest({ version: 'latest' }) }))).toThrow()
    expect(() => parsePackage(pkg({ manifest: manifest({ api: 99 }) }))).toThrow()
  })

  it('rejects unknown permissions and non-https connect origins', () => {
    expect(() =>
      parsePackage(pkg({ manifest: manifest({ permissions: ['everything'] as never }) }))
    ).toThrow()
    expect(() =>
      parsePackage(
        pkg({ manifest: manifest({ permissions: ['net'], connect: ['http://evil.example'] }) })
      )
    ).toThrow()
    expect(() =>
      parsePackage(
        pkg({
          manifest: manifest({ permissions: ['net'], connect: ['https://ok.example/path?q=1'] })
        })
      )
    ).toThrow('bare origin')
  })

  it('requires the net permission for connect origins', () => {
    expect(() =>
      parsePackage(pkg({ manifest: manifest({ connect: ['https://api.example'] }) }))
    ).toThrow('net permission')
  })

  it('requires a publisher when a signature is present', () => {
    const sig = 'A'.repeat(88)
    expect(() => parsePackage(pkg({ signature: sig.slice(0, 86) + '==' }))).toThrow('publisher')
  })

  it('rejects oversized code', () => {
    expect(() => parsePackage(pkg({ code: 'x'.repeat(600 * 1024) }))).toThrow('too large')
  })
})

describe('signing', () => {
  async function signed(): Promise<{ text: string; key: string }> {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const pub = btoa(
      String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
    )
    const m = manifest({ publisher: { name: 'Quad4', key: pub } })
    const code = 'badinage.log("signed")'
    const payload = new TextEncoder().encode(
      `${JSON.stringify({
        api: 1,
        connect: [],
        id: 'org.example.test',
        name: 'Test',
        permissions: ['menus'],
        publisher: { key: pub, name: 'Quad4' }
      })}\n${code}`
    )
    const sig = await crypto.subtle.sign('Ed25519', pair.privateKey, payload)
    const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    return { text: JSON.stringify({ manifest: m, signature, code }), key: pub }
  }

  it('verifies a valid signature and fingerprints the key', async () => {
    const { text, key } = await signed()
    const p = parsePackage(text)
    expect(await verifyPackage(p)).toBe(true)
    const fp = await keyFingerprint(key)
    expect(fp).toMatch(/^([0-9a-f]{2} ){15}[0-9a-f]{2}$/)
  })

  it('rejects tampered code and wrong keys', async () => {
    const { text } = await signed()
    const p = parsePackage(text)
    expect(await verifyPackage({ ...p, code: `${p.code} // tampered` })).toBe(false)
    const other = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const wrongKey = btoa(
      String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey)))
    )
    const tampered = {
      ...p,
      manifest: { ...p.manifest, publisher: { name: 'Quad4', key: wrongKey } }
    }
    expect(await verifyPackage(tampered)).toBe(false)
  })
})

describe('compareVersions', () => {
  it('orders semver triples', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })
})

describe('signedPayload', () => {
  it('is stable across manifest key order', () => {
    const a = signedPayload({ manifest: manifest(), code: 'c' })
    const reordered = {
      manifest: { ...manifest(), permissions: ['menus' as const] },
      code: 'c'
    }
    expect(signedPayload(reordered)).toEqual(a)
  })
})
