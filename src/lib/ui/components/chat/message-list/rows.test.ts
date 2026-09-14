import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '$lib/state/chats.svelte'

import { buildRows, messageRowId, type ListRow } from './rows'

function rowAt(rows: ListRow[], index: number): ListRow {
  const row = rows[index]
  if (row === undefined) throw new Error(`no row at index ${index}`)
  return row
}

function msg(id: string, timestamp: number, opts: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    peerJid: 'peer@x',
    body: `body ${id}`,
    outgoing: false,
    timestamp,
    encrypted: false,
    delivered: true,
    read: false,
    reactions: {},
    ...opts
  }
}

const DAY = 86_400_000
const T0 = Date.UTC(2025, 0, 1, 12, 0, 0)
const ctx = { typing: false, seen: undefined }

describe('buildRows', () => {
  it('returns an empty list for an empty conversation', () => {
    expect(buildRows([], ctx)).toEqual([])
  })

  it('emits one day row and one message row for a single message', () => {
    const rows = buildRows([msg('a', T0)], ctx)
    expect(rows.map((r) => r.kind)).toEqual(['day', 'message'])
    const row = rowAt(rows, 1)
    expect(row.kind === 'message' && row.grouped).toBe(true)
    expect(row.key).toBe('m:a')
  })

  it('groups same-sender messages inside five minutes', () => {
    const rows = buildRows([msg('a', T0), msg('b', T0 + 60_000), msg('c', T0 + 120_000)], ctx)
    const groups = rows.filter((r) => r.kind === 'message').map((r) => r.grouped)
    expect(groups).toEqual([true, false, false])
  })

  it('starts a group on sender change', () => {
    const rows = buildRows([msg('a', T0), msg('b', T0 + 60_000, { outgoing: true })], ctx)
    const groups = rows.filter((r) => r.kind === 'message').map((r) => r.grouped)
    expect(groups).toEqual([true, true])
  })

  it('starts a group on nick change in a room', () => {
    const rows = buildRows(
      [msg('a', T0, { nick: 'n1' }), msg('b', T0 + 60_000, { nick: 'n2' })],
      ctx
    )
    const groups = rows.filter((r) => r.kind === 'message').map((r) => r.grouped)
    expect(groups).toEqual([true, true])
  })

  it('starts a group after a gap over five minutes', () => {
    const rows = buildRows([msg('a', T0), msg('b', T0 + 400_000)], ctx)
    const groups = rows.filter((r) => r.kind === 'message').map((r) => r.grouped)
    expect(groups).toEqual([true, true])
  })

  it('emits a day row and a group at each day boundary', () => {
    const rows = buildRows([msg('a', T0), msg('b', T0 + DAY)], ctx)
    expect(rows.map((r) => r.kind)).toEqual(['day', 'message', 'day', 'message'])
    expect(rowAt(rows, 0).key).not.toBe(rowAt(rows, 2).key)
    const second = rowAt(rows, 3)
    expect(second.kind === 'message' && second.grouped).toBe(true)
  })

  it('appends typing and seen rows at the tail in order', () => {
    const rows = buildRows([msg('a', T0)], {
      ...ctx,
      typing: true,
      seen: { read: true, delivered: true }
    })
    // seen after typing is unusual but the model keeps ctx order stable
    expect(rows.map((r) => r.kind)).toEqual(['day', 'message', 'typing', 'seen'])
    const seen = rowAt(rows, 3)
    expect(seen.kind === 'seen' && seen.read).toBe(true)
  })

  it('keeps row keys unique and stable across rebuilds', () => {
    const messages = [msg('a', T0), msg('b', T0 + DAY), msg('c', T0 + DAY + 60_000)]
    const a = buildRows(messages, { ...ctx, typing: true })
    const b = buildRows(messages, { ...ctx, typing: true })
    const keysA = a.map((r) => r.key)
    expect(new Set(keysA).size).toBe(keysA.length)
    expect(keysA).toEqual(b.map((r) => r.key))
  })

  it('keeps message keys stable when earlier messages are prepended', () => {
    const old = [msg('b', T0 + 60_000)]
    const grown = [msg('a', T0), msg('b', T0 + 60_000)]
    const oldKeys = buildRows(old, ctx).map((r) => r.key)
    const grownKeys = buildRows(grown, ctx).map((r) => r.key)
    expect(grownKeys).toContain('m:b')
    expect(oldKeys.filter((k) => k.startsWith('m:'))).toEqual(['m:b'])
  })

  it('tracks message indexes through day separators', () => {
    const rows = buildRows([msg('a', T0), msg('b', T0 + DAY), msg('c', T0 + DAY + 10_000)], ctx)
    const indexes = rows.filter((r) => r.kind === 'message').map((r) => r.index)
    expect(indexes).toEqual([0, 1, 2])
  })
})

describe('messageRowId', () => {
  it('matches the dom id rendered on message rows', () => {
    expect(messageRowId('stanza-1')).toBe('m-stanza-1')
  })
})
