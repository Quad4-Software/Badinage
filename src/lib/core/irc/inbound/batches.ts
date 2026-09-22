// IRCv3 BATCH tracking for the inbound dispatcher: open batches by ref,
// draft/multiline accumulation, chathistory counting and the pending
// history query that a closing batch resolves.

import type { MamPageResult } from '$lib/core/xmpp/stanzas'

import type { IrcLine } from '../line'

export interface Batch {
  type: string
  count: number
  // draft/chathistory-end tag on the BATCH start, when sent
  end?: boolean | undefined
  // msgid of the first message in the batch, the older-page cursor
  firstMsgid?: string | undefined
  // multiline accumulator plus its first line for sender context
  lines?: string[] | undefined
  first?: IrcLine | undefined
}

export class BatchTracker {
  private batches = new Map<string, Batch>()
  private pendingHistory: { limit: number } | null = null

  // a CHATHISTORY query is in flight. The next chathistory batch or
  // FAIL resolves it and limit feeds the batch-exhaustion heuristic
  noteHistory(limit: number): void {
    this.pendingHistory = { limit }
  }

  typeOf(ref: string): string | undefined {
    return this.batches.get(ref)?.type
  }

  of(line: IrcLine): Batch | undefined {
    const ref = line.tags['batch']
    return ref === undefined ? undefined : this.batches.get(ref)
  }

  // absorb a member line into its batch. True means the line went into
  // a draft/multiline accumulator and must not be emitted standalone.
  // multiline=false callers (tagmsg) still count chathistory but never
  // merge into the accumulator
  absorb(line: IrcLine, multiline: boolean): boolean {
    const batch = this.of(line)
    if (multiline && batch?.type === 'draft/multiline') {
      batch.lines ??= []
      // draft/multiline-concat is valueless: join onto the previous
      // line instead of starting a new one
      const prev = 'draft/multiline-concat' in line.tags ? (batch.lines.pop() ?? '') : ''
      batch.lines.push(prev + line.text)
      batch.first ??= line
      return true
    }
    if (batch?.type === 'chathistory') {
      batch.count++
      batch.firstMsgid ??= line.tags['msgid']
    }
    return false
  }

  // BATCH +ref: open a batch under the reference
  open(line: IrcLine): void {
    const ref = line.params[0]
    if (!ref?.startsWith('+')) return
    const end = line.tags['draft/chathistory-end']
    this.batches.set(ref.slice(1), {
      type: line.params[1] ?? '',
      count: 0,
      ...(end !== undefined ? { end: end === 'true' } : {})
    })
  }

  // BATCH -ref: drop the batch and hand back what the caller needs - the
  // batch for history finalization, plus joined text and the first line
  // (for sender context) when a draft/multiline batch closed
  close(line: IrcLine): { batch: Batch; multiline?: { text: string; first: IrcLine } } | undefined {
    const ref = line.params[0]
    if (!ref || ref.startsWith('+')) return undefined
    const batch = this.batches.get(ref.slice(1))
    this.batches.delete(ref.slice(1))
    if (!batch) return undefined
    if (batch.type === 'draft/multiline' && batch.lines && batch.first) {
      return { batch, multiline: { text: batch.lines.join('\n'), first: batch.first } }
    }
    return { batch }
  }

  // resolve the pending chathistory query. draft/chathistory-end is
  // authoritative. Without it a short page means the archive ran out
  finishHistory(batch: Batch | undefined, failed: boolean): MamPageResult | undefined {
    const pending = this.pendingHistory
    if (!pending) return undefined
    this.pendingHistory = null
    const complete =
      failed || (batch?.end !== undefined ? batch.end : (batch?.count ?? 0) < pending.limit)
    const result: MamPageResult = { complete }
    if (!failed && batch?.firstMsgid) result.first = batch.firstMsgid
    return result
  }
}
