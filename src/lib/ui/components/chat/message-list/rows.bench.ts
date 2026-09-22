import { test } from 'vitest'

import type { ChatMessage } from '$lib/state/chats.svelte'
import { emptyMessage } from '$lib/state/conversation.svelte'

import { buildRows } from './rows'

// the row model rebuilds on every ingest while a conversation is open.
// 1000 messages is the live cap, so this is the per-keystroke worst case
const DAY = 24 * 60 * 60 * 1000
const base = 1_700_000_000_000

function corpus(size: number): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (let i = 0; i < size; i++) {
    messages.push({
      ...emptyMessage('peer@example.net'),
      id: `bench-${i}`,
      body: `bench message ${i}`,
      timestamp: base + Math.floor(i / 200) * DAY + i * 30_000,
      outgoing: i % 5 === 0,
      nick: `n${i % 7}`
    })
  }
  return messages
}

test('buildRows scales with the live cap', async ({ bench }) => {
  const small = corpus(100)
  const full = corpus(1000)
  await bench.compare(
    bench('100 messages', () => {
      buildRows(small, { typing: false, seen: undefined })
    }),
    bench('1000 messages', () => {
      buildRows(full, { typing: false, seen: undefined })
    })
  )
})
