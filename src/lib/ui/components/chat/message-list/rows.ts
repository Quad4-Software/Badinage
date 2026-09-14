// Row model for the virtualized message list. Everything virtualized is
// a row: day separators, messages, the typing indicator and the read
// marker. The load-older pager is deliberately NOT a row: it lives above
// the list inside the scroller so prepended archive pages genuinely land
// at index 0. The virtualizer's shift compensation pads its size cache
// at the head on growth, so a row sitting in front of the insertion
// point would misalign every cached size.
//
// Kept pure so the model is unit-testable without a DOM.

import type { ChatMessage } from '$lib/state/chats.svelte'
import { isSameDay } from '$lib/utils/time'

// a new visual group starts on a different sender, a day separator, or
// a gap of more than five minutes
const GROUP_GAP_MS = 5 * 60 * 1000

export type ListRow =
  | { kind: 'day'; key: string; timestamp: number }
  | {
      kind: 'message'
      key: string
      message: ChatMessage
      // index inside conversation.messages (day rows are not messages)
      index: number
      grouped: boolean
    }
  | { kind: 'typing'; key: string }
  | { kind: 'seen'; key: string; read: boolean; delivered: boolean }

export interface RowContext {
  typing: boolean
  // dm read marker at the tail
  seen: { read: boolean; delivered: boolean } | undefined
}

function grouped(prev: ChatMessage | undefined, message: ChatMessage): boolean {
  if (prev === undefined) return true
  if (!isSameDay(prev.timestamp, message.timestamp)) return true
  if (message.timestamp - prev.timestamp > GROUP_GAP_MS) return true
  return prev.outgoing !== message.outgoing || prev.nick !== message.nick
}

export function buildRows(messages: readonly ChatMessage[], ctx: RowContext): ListRow[] {
  const rows: ListRow[] = []
  let prev: ChatMessage | undefined
  for (const [index, message] of messages.entries()) {
    if (prev === undefined || !isSameDay(prev.timestamp, message.timestamp)) {
      rows.push({ kind: 'day', key: `day:${message.timestamp}`, timestamp: message.timestamp })
    }
    rows.push({
      kind: 'message',
      key: `m:${message.id}`,
      message,
      index,
      grouped: grouped(prev, message)
    })
    prev = message
  }
  if (ctx.typing) rows.push({ kind: 'typing', key: 'row:typing' })
  if (ctx.seen !== undefined) {
    rows.push({ kind: 'seen', key: 'row:seen', read: ctx.seen.read, delivered: ctx.seen.delivered })
  }
  return rows
}

// the id a quote jump targets: matches the dom id rendered on the row
export function messageRowId(id: string): string {
  return `m-${id}`
}
