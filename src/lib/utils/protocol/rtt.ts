// XEP-0301 real-time text action ops. Positions count Unicode code
// points, not UTF-16 units, so everything here works on spread arrays
// rather than string indexes. Pure and DOM-free so both the stanza
// parser and the composer diff can share it.

export type RttEvent = 'new' | 'reset' | 'edit' | 'init' | 'cancel'

// t: insert text at p (default: append). e: erase n code points ending
// at p (default: end of buffer). d: forward-delete n code points
// starting at p (default: at end, which is a no-op). w: a pause of n
// milliseconds, only meaningful when key press timing is reproduced;
// we parse but never emit it.
export type RttOp =
  | { type: 't'; p?: number | undefined; text: string }
  | { type: 'e'; p?: number | undefined; n?: number | undefined }
  | { type: 'd'; p?: number | undefined; n?: number | undefined }
  | { type: 'w'; n?: number | undefined }

export interface RttStanza {
  event: RttEvent
  seq?: number | undefined
  ops: RttOp[]
}

const RTT_BUFFER_MAX = 16_384

function codePoints(text: string): string[] {
  return [...text]
}

// Diff prev -> next as a single erase-from-position plus insert-at-
// position pair, the smallest op set that covers any cursor edit. The
// common prefix and suffix stay untouched.
export function diffRtt(prev: string, next: string): RttOp[] {
  const a = codePoints(prev)
  const b = codePoints(next)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let aEnd = a.length
  let bEnd = b.length
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--
    bEnd--
  }
  const ops: RttOp[] = []
  const removed = aEnd - start
  const inserted = b.slice(start, bEnd).join('')
  if (removed > 0) ops.push({ type: 'e', p: aEnd, n: removed })
  if (inserted) ops.push({ type: 't', p: start, text: inserted })
  return ops
}

// Apply one op list to a buffer. Positions are code point indexes into
// the pre-op buffer state as each op lands. Out-of-range positions are
// clamped rather than throwing: a desynced sender must not crash the
// receiver.
export function applyRttOps(buffer: string, ops: RttOp[]): string {
  let text = codePoints(buffer)
  for (const op of ops) {
    if (op.type === 'w') continue
    const p = Math.min(Math.max(op.p ?? text.length, 0), text.length)
    if (op.type === 't') {
      const insert = codePoints(op.text)
      if (text.length + insert.length > RTT_BUFFER_MAX) break
      text = [...text.slice(0, p), ...insert, ...text.slice(p)]
    } else {
      const n = op.n ?? 1
      if (op.type === 'e') {
        // e erases backward: n code points ending at p
        text = [...text.slice(0, Math.max(0, p - n)), ...text.slice(p)]
      } else {
        // d deletes forward: n code points starting at p
        text = [...text.slice(0, p), ...text.slice(p + n)]
      }
    }
  }
  return text.join('')
}
