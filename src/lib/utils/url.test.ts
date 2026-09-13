import { describe, expect, it } from 'vitest'

import { isWebSocketUrl, safeUrl } from './url'

describe('safeUrl', () => {
  it('allows http and https', () => {
    expect(safeUrl('https://example.org/f.png')).toBe('https://example.org/f.png')
    expect(safeUrl('http://example.org/f.png')).toBe('http://example.org/f.png')
  })

  it('allows blob urls and inline media data', () => {
    expect(safeUrl('blob:https://example.org/1')).toBe('blob:https://example.org/1')
    expect(safeUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(safeUrl('data:audio/ogg;base64,AAA')).toBe('data:audio/ogg;base64,AAA')
    expect(safeUrl('data:video/mp4;base64,AAA')).toBe('data:video/mp4;base64,AAA')
  })

  it('rejects other schemes and non-media data urls', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html;base64,AAA')).toBeNull()
    expect(safeUrl('file:///etc/passwd')).toBeNull()
    expect(safeUrl('xmpp:romeo@example.org')).toBeNull()
  })

  it('allows same-origin relative urls', () => {
    expect(safeUrl('/local/path.png')).toBe('/local/path.png')
    expect(safeUrl('/icons/icon-192.png?v=2')).toBe('/icons/icon-192.png?v=2')
  })

  it('rejects relative, empty and malformed input', () => {
    expect(safeUrl('example.org/f.png')).toBeNull()
    expect(safeUrl('')).toBeNull()
    expect(safeUrl('   ')).toBeNull()
  })

  it('rejects schemes hidden behind control characters', () => {
    expect(safeUrl('java\tscript:alert(1)')).toBeNull()
    expect(safeUrl('java\nscript:alert(1)')).toBeNull()
  })
})

describe('isWebSocketUrl', () => {
  it('accepts ws and wss endpoints', () => {
    expect(isWebSocketUrl('wss://example.net/xmpp-websocket')).toBe(true)
    expect(isWebSocketUrl('ws://localhost:5280/ws')).toBe(true)
  })

  it('rejects bosh and other endpoints', () => {
    expect(isWebSocketUrl('https://example.net/bosh')).toBe(false)
    expect(isWebSocketUrl('http://example.net/bosh')).toBe(false)
    expect(isWebSocketUrl('')).toBe(false)
    expect(isWebSocketUrl('example.net/ws')).toBe(false)
  })
})
