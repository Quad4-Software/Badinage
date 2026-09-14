// Package and manifest validation. A .badinage.json file carries
// {manifest, signature?, code}. Everything is checked before the code
// ever reaches a worker: shape, sizes, permission names, connect
// origins and the id/version grammar.

import {
  EXT_API_VERSION,
  EXT_LIMITS,
  KNOWN_PERMISSIONS,
  type ExtManifest,
  type ExtPackage,
  type Permission
} from './types'

export class ManifestError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(msg: string): never {
  throw new ManifestError(msg)
}

function validateConnect(urls: unknown): string[] {
  if (!Array.isArray(urls)) fail('connect must be an array')
  if (urls.length > EXT_LIMITS.connectMax) fail('too many connect origins')
  return urls.map((u) => {
    if (typeof u !== 'string') fail('connect entries must be strings')
    let url: URL
    try {
      url = new URL(u)
    } catch {
      fail(`bad connect origin: ${u}`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'wss:')
      fail(`connect origin must be https or wss: ${u}`)
    if (url.pathname !== '/' || url.search || url.hash || url.username)
      fail(`connect must be a bare origin: ${u}`)
    return url.origin
  })
}

function validateManifest(raw: unknown): ExtManifest {
  if (!isRecord(raw)) fail('manifest must be an object')
  const { id, name, version, api, description, publisher, permissions, connect } = raw
  if (typeof id !== 'string' || !EXT_LIMITS.idPattern.test(id)) fail('bad extension id')
  if (typeof name !== 'string' || name.length === 0 || name.length > EXT_LIMITS.nameMax)
    fail('bad extension name')
  if (typeof version !== 'string' || !EXT_LIMITS.versionPattern.test(version)) fail('bad version')
  if (typeof api !== 'number' || !Number.isInteger(api)) fail('bad api version')
  if (api > EXT_API_VERSION) fail(`extension requires api ${api}, app supports ${EXT_API_VERSION}`)
  if (
    description !== undefined &&
    (typeof description !== 'string' || description.length > EXT_LIMITS.descriptionMax)
  )
    fail('bad description')
  if (!Array.isArray(permissions)) fail('permissions must be an array')
  for (const p of permissions) {
    if (typeof p !== 'string' || !(KNOWN_PERMISSIONS as readonly string[]).includes(p))
      fail(`unknown permission: ${String(p)}`)
  }
  let pub: ExtManifest['publisher']
  if (publisher !== undefined) {
    if (
      !isRecord(publisher) ||
      typeof publisher.name !== 'string' ||
      typeof publisher.key !== 'string'
    )
      fail('bad publisher')
    const keyBytes = decodeB64(publisher.key)
    if (!keyBytes || keyBytes.length !== 32) fail('bad publisher key')
    pub = { name: publisher.name.slice(0, EXT_LIMITS.nameMax), key: publisher.key }
  }
  const conn = connect === undefined ? [] : validateConnect(connect)
  if (conn.length > 0 && !permissions.includes('net'))
    fail('connect origins require the net permission')
  return {
    id,
    name,
    version,
    api,
    ...(description !== undefined ? { description } : {}),
    ...(pub ? { publisher: pub } : {}),
    permissions: permissions as Permission[],
    connect: conn
  }
}

function decodeB64(value: string): Uint8Array | null {
  try {
    const bin = atob(value)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function parsePackage(text: string): ExtPackage {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    fail('extension package is not valid json')
  }
  if (!isRecord(raw)) fail('extension package must be an object')
  const manifest = validateManifest(raw.manifest)
  const { signature, code } = raw
  if (signature !== undefined) {
    if (typeof signature !== 'string' || decodeB64(signature)?.length !== 64) fail('bad signature')
    if (!manifest.publisher) fail('signature without a publisher key')
  }
  if (manifest.publisher && signature === undefined) fail('publisher declared but unsigned')
  if (typeof code !== 'string' || code.length === 0) fail('missing code')
  if (new TextEncoder().encode(code).length > EXT_LIMITS.codeMaxBytes) fail('code too large')
  return { manifest, ...(signature !== undefined ? { signature } : {}), code }
}

// the byte string a signature commits to. Key order inside the nested
// publisher object is fixed so re-serialized packages stay verifiable
export function signedPayload(pkg: ExtPackage): Uint8Array {
  const m = pkg.manifest
  const canonical = JSON.stringify({
    api: m.api,
    connect: m.connect,
    ...(m.description !== undefined ? { description: m.description } : {}),
    id: m.id,
    name: m.name,
    permissions: m.permissions,
    ...(m.publisher ? { publisher: { key: m.publisher.key, name: m.publisher.name } } : {})
  })
  return new TextEncoder().encode(`${canonical}\n${pkg.code}`)
}

// semver-ish compare for update checks: -1 a<b, 0 equal, 1 a>b
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map(Number)
  const pb = b.split(/[.-]/).map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1
  }
  return 0
}
