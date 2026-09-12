import { describe, expect, it } from 'vitest'

import { safeUrl } from './url'

describe('safeUrl', () => {
  it('allows http and https', () => {
    expect(safeUrl('https://example.org/f.png')).toBe('https://example.org/f.png')
    expect(safeUrl('http://example.org/f.png')).toBe('http://example.org/f.png')
  })

  it('allows blob urls and inline image or audio data', () => {
    expect(safeUrl('blob:https://example.org/1')).toBe('blob:https://example.org/1')
    expect(safeUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(safeUrl('data:audio/ogg;base64,AAA')).toBe('data:audio/ogg;base64,AAA')
  })

  it('rejects other schemes and non-media data urls', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html;base64,AAA')).toBeNull()
    expect(safeUrl('data:video/mp4,AAA')).toBeNull()
    expect(safeUrl('file:///etc/passwd')).toBeNull()
    expect(safeUrl('xmpp:romeo@example.org')).toBeNull()
  })

  it('rejects relative, empty and malformed input', () => {
    expect(safeUrl('/local/path.png')).toBeNull()
    expect(safeUrl('example.org/f.png')).toBeNull()
    expect(safeUrl('')).toBeNull()
    expect(safeUrl('   ')).toBeNull()
  })

  it('rejects schemes hidden behind control characters', () => {
    expect(safeUrl('java\tscript:alert(1)')).toBeNull()
    expect(safeUrl('java\nscript:alert(1)')).toBeNull()
  })
})
