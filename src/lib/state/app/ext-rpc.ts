// Host-side helpers for the extension store: the payload scrub every
// worker-bound call passes through, persisted settings values, and the
// permission-checked net.fetch proxy. Extracted for the size gate.

import { EXT_LIMITS, type InstalledExt } from '$lib/core/extensions/types'
import { idb } from '$lib/core/storage/idb'

const STORAGE_PREFIX = 'ext:kv:'

// whitelist the fields that cross the worker boundary so a new
// payload key never leaks to extensions by default
export function scrubPayload(ext: InstalledExt, payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return payload
  const src = payload as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  for (const k of [
    'id',
    'peerJid',
    'jid',
    'outgoing',
    'name',
    'args',
    'accountJid',
    'kind',
    'type',
    'from',
    'nick',
    'timestamp'
  ]) {
    if (k in src) clean[k] = src[k]
  }
  if (ext.permissions.includes('messages.read') && 'body' in src) clean.body = src.body
  return clean
}

// settings values live in the extension's own kv namespace under a
// settings: prefix so they cannot collide with its own keys
export async function loadExtSettings(id: string): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {}
  const prefix = `${STORAGE_PREFIX}${id}:settings:`
  for (const key of await idb.keys('kv')) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue
    const raw = await idb.get<string>('kv', key)
    if (typeof raw !== 'string') continue
    try {
      values[key.slice(prefix.length)] = JSON.parse(raw)
    } catch {
      // a corrupt entry just falls back to the field default
    }
  }
  return values
}

export async function persistExtSetting(id: string, key: string, value: unknown): Promise<void> {
  await idb.set('kv', `${STORAGE_PREFIX}${id}:settings:${key}`, JSON.stringify(value))
}

// net.fetch, permission-checked: origin must be in the manifest's
// connect list, credentials never ride along and auth-shaped headers
// are stripped before the request leaves
export async function proxiedFetch(
  ext: InstalledExt,
  url: string,
  init: Record<string, unknown>
): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('bad url')
  }
  if (!ext.connect.includes(parsed.origin)) throw new Error('origin not in connect list')
  const method = typeof init.method === 'string' ? init.method.toUpperCase() : 'GET'
  if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(method)) throw new Error('bad method')
  const headers: Record<string, string> = {}
  if (typeof init.headers === 'object' && init.headers !== null) {
    for (const [k, v] of Object.entries(init.headers as Record<string, unknown>)) {
      // never forward auth-shaped headers, the proxy strips them
      if (/^(authorization|cookie|proxy-authorization|x-api-key)$/i.test(k)) continue
      headers[k] = String(v).slice(0, 500)
    }
  }
  const res = await fetch(parsed.href, {
    method,
    headers,
    ...(typeof init.body === 'string' ? { body: init.body.slice(0, 65536) } : {}),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`http ${res.status}`)
  const text = await res.text()
  return text.slice(0, EXT_LIMITS.netResponseMaxBytes)
}
