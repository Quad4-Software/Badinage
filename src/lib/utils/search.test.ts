import { describe, expect, it } from 'vitest'

import { findMessageHits, MIN_SEARCH_CHARS } from './search'

function convo(peerJid: string, bodies: [string, number][]): {
  peerJid: string
  messages: { id: string; body: string; timestamp: number }[]
} {
  return {
    peerJid,
    messages: bodies.map(([body, timestamp], i) => ({ id: `${peerJid}#${i}`, body, timestamp }))
  }
}

describe('findMessageHits', () => {
  const convs = [
    convo('a@x.org', [
      ['hello there', 100],
      ['nothing matching', 200],
      ['hello again', 300]
    ]),
    convo('b@x.org', [['say hello to all', 250]])
  ]

  it('matches bodies case-insensitively, newest first', () => {
    const hits = findMessageHits(convs, 'HELLO', 10)
    expect(hits.map((h) => h.messageId)).toEqual(['a@x.org#2', 'b@x.org#0', 'a@x.org#0'])
    expect(hits[0]?.peerJid).toBe('a@x.org')
  })

  it('requires every token to appear in one body', () => {
    expect(findMessageHits(convs, 'hello all', 10).map((h) => h.peerJid)).toEqual(['b@x.org'])
    expect(findMessageHits(convs, 'hello missing', 10)).toEqual([])
  })

  it('ignores queries shorter than the minimum', () => {
    expect('x'.length < MIN_SEARCH_CHARS).toBe(true)
    expect(findMessageHits(convs, 'x', 10)).toEqual([])
  })

  it('caps the result count', () => {
    expect(findMessageHits(convs, 'hello', 2)).toHaveLength(2)
    expect(findMessageHits(convs, 'hello', 0)).toEqual([])
  })

  it('snippets center on the first token', () => {
    const [hit] = findMessageHits(
      [convo('c@x.org', [[`${'pad '.repeat(40)}needle${' pad'.repeat(40)}`, 1]])],
      'needle',
      5
    )
    expect(hit?.snippet).toContain('needle')
    expect(hit?.snippet.startsWith('…')).toBe(true)
    expect(hit?.snippet.endsWith('…')).toBe(true)
  })
})
