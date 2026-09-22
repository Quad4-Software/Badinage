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

// a new visual run starts on a different sender, a day separator, or
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
      // first and last bubble of a same-sender run. Both flags drive the
      // merged corners and the tighter run gap between continuation rows
      first: boolean
      last: boolean
    }
  | { kind: 'typing'; key: string }
  | { kind: 'seen'; key: string; read: boolean; delivered: boolean }

export interface RowContext {
  typing: boolean
  // dm read marker at the tail
  seen: { read: boolean; delivered: boolean } | undefined
}

// true when `message` opens a new run after `prev`
function startsRun(prev: ChatMessage | undefined, message: ChatMessage): boolean {
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
    const next = messages[index + 1]
    rows.push({
      kind: 'message',
      key: `m:${message.id}`,
      message,
      index,
      first: startsRun(prev, message),
      last: next === undefined || startsRun(message, next)
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

// row attributes for the virtualizer. Spacing must be padding not
// margin: the virtualizer measures the element box and row offsets
// ignore margins between rows
export function itemProps({ item }: { item: ListRow }): Record<string, string> | undefined {
  if (item.kind === 'message') {
    return {
      id: messageRowId(item.message.id),
      class:
        item.index > 0
          ? item.first
            ? 'pt-[var(--density-msg-gap)]'
            : 'pt-[var(--density-msg-run-gap)]'
          : ''
    }
  }
  if (item.kind === 'day') {
    return { class: 'text-muted-foreground py-3 text-center text-xs', 'aria-hidden': 'true' }
  }
  if (item.kind === 'typing') {
    return { class: 'flex items-center gap-2 pt-3', 'aria-live': 'polite' }
  }
  if (item.kind === 'seen') {
    return {
      class: 'text-muted-foreground flex items-center justify-end gap-1 pt-1 text-[0.65rem]',
      'aria-live': 'polite'
    }
  }
  return undefined
}
