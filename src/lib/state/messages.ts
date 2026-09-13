// Message-level mutations shared by stanza ingest and ui actions:
// reactions (XEP-0444) and corrections (XEP-0308). These operate on an
// already-located ChatMessage; ChatStore owns the lookup.

import type { ChatMessage } from './conversation.svelte'

// Each sender's new reaction set replaces their previous one.
export function applyReactions(target: ChatMessage, sender: string, emojis: string[]): void {
  for (const [emoji, senders] of Object.entries(target.reactions)) {
    const next = senders.filter((s) => s !== sender)
    target.reactions[emoji] = next
  }
  // drop empty sets afterwards to keep reactions reactive
  for (const [emoji, senders] of Object.entries(target.reactions)) {
    if (senders.length === 0) {
      const { [emoji]: _gone, ...rest } = target.reactions
      void _gone
      target.reactions = rest
    }
  }
  for (const emoji of emojis) {
    const senders = target.reactions[emoji] ?? []
    if (!senders.includes(sender)) senders.push(sender)
    target.reactions[emoji] = senders
  }
}

// A correction keeps the message's original position; the timestamp is
// only used for ordering on the wire and is dropped here.
export function applyCorrection(target: ChatMessage, body: string): void {
  target.body = body
  target.edited = true
}
