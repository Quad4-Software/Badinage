import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchStatus, parseStatus } from './status'

describe('parseStatus', () => {
  it('parses each declared mode', () => {
    for (const mode of ['ok', 'soft', 'full', 'outage'] as const) {
      expect(parseStatus({ mode }).mode).toBe(mode)
    }
  })

  it('keeps an optional message and a valid until timestamp', () => {
    const status = parseStatus({
      mode: 'full',
      message: 'database migration',
      until: '2030-01-01T00:00:00Z'
    })
    expect(status.message).toBe('database migration')
    expect(status.until).toBe('2030-01-01T00:00:00Z')
  })

  it('drops an unparseable until but keeps the mode', () => {
    const status = parseStatus({ mode: 'soft', until: 'not a date' })
    expect(status.mode).toBe('soft')
    expect(status.until).toBeUndefined()
  })

  it('degrades unknown modes and malformed payloads to ok', () => {
    expect(parseStatus({ mode: 'purple' }).mode).toBe('ok')
    expect(parseStatus('full').mode).toBe('ok')
    expect(parseStatus(null).mode).toBe('ok')
    expect(parseStatus(undefined).mode).toBe('ok')
    expect(parseStatus(42).mode).toBe('ok')
  })

  it('ignores empty messages and non-string fields', () => {
    const status = parseStatus({ mode: 'soft', message: '', until: 7 })
    expect(status.message).toBeUndefined()
    expect(status.until).toBeUndefined()
  })
})

describe('fetchStatus', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns null when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await fetchStatus('/status.json')).toBeNull()
  })

  it('parses a declared status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"mode":"soft","message":"m"}')))
    const status = await fetchStatus('/status.json')
    expect(status?.mode).toBe('soft')
    expect(status?.message).toBe('m')
  })

  it('treats a non-json response (spa fallback) as ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<!doctype html><title>app</title>'))
    )
    expect((await fetchStatus('/status.json'))?.mode).toBe('ok')
  })
})
