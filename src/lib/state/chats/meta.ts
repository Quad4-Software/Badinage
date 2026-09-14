// Conversation maintenance for ChatStore: the expiry sweep, the buzz
// rate limit, per-conversation meta (ephemeral timer, notify override),
// remote displayed markers, dedup and hydration. Free functions so
// chats.svelte.ts stays under the size gate.

import type { SvelteMap } from 'svelte/reactivity'

import { ATTENTION_COOLDOWN_MS, LIVE_MESSAGE_CAP, RTT_TTL_MS } from '$lib/constants'
import { bareJid } from '$lib/utils/jid'

import type { ConversationPersistence, ConversationMeta } from '../persistence.svelte'
import type { ChatMessage, Conversation } from '../conversation.svelte'

const DEDUP_CAP = 500

// Drop expired ephemeral messages and stale rtt buffers. Runs on the
// sweep interval. The unread counter is recomputed so badges stay
// truthful after a purge.
export function sweepExpired(
  conversations: SvelteMap<string, Conversation>,
  persistence: ConversationPersistence
): void {
  const now = Date.now()
  for (const conversation of conversations.values()) {
    // skip the filter allocation outright unless a row actually
    // expired - most conversations carry no ephemeral messages at all
    if (conversation.messages.some((m) => m.expiresAt !== undefined && m.expiresAt <= now)) {
      conversation.messages = conversation.messages.filter(
        (m) => m.expiresAt === undefined || m.expiresAt > now
      )
      conversation.unread = conversation.messages.filter((m) => !m.outgoing && !m.read).length
      persistence.schedule(conversation)
    }
    for (const [sender, live] of conversation.liveText) {
      if (now - live.at > RTT_TTL_MS) conversation.liveText.delete(sender)
    }
  }
}

// XEP-0224 outgoing rate limit: one buzz per peer per window so a
// tap-happy user cannot spam the stanza.
export function canBuzz(buzzedAt: Map<string, number>, peer: string): boolean {
  const last = buzzedAt.get(bareJid(peer))
  return last === undefined || Date.now() - last >= ATTENTION_COOLDOWN_MS
}

export function noteBuzz(buzzedAt: Map<string, number>, peer: string): void {
  buzzedAt.set(bareJid(peer), Date.now())
}

// Persist the per-conversation meta record (ephemeral timer + notify).
export function saveMeta(persistence: ConversationPersistence, conversation: Conversation): void {
  const meta: ConversationMeta = {}
  if (conversation.ephemeralTimer !== undefined) meta.ephemeral = conversation.ephemeralTimer
  if (conversation.notify !== undefined) meta.notify = conversation.notify
  persistence.saveMeta(conversation.peerJid, meta)
}

// XEP-0490: another of our resources displayed up to stanzaId in this
// conversation, so nothing before it counts as unread here anymore.
export function markDisplayedRemote(
  conversations: SvelteMap<string, Conversation>,
  persistence: ConversationPersistence,
  peer: string,
  stanzaId: string
): void {
  const conversation = conversations.get(bareJid(peer))
  if (!conversation) return
  const target = conversation.messages.find((m) => m.id === stanzaId || m.wireId === stanzaId)
  // a marker naming a stanza we never received is ignored rather than
  // treated as "everything before the end": with no anchor there is no
  // safe ordering, and trusting it would let a stale or corrupt MDS
  // item silently clear unread state
  if (!target) return
  for (const m of conversation.messages) {
    if (!m.outgoing && !m.read && m.timestamp <= target.timestamp) m.read = true
  }
  conversation.unread = conversation.messages.filter((m) => !m.outgoing && !m.read).length
  persistence.schedule(conversation)
}

// IRC draft/read-marker: another of our clients advanced the read
// cursor to a timestamp rather than a stanza id. There is no anchor
// message to distrust, so the timestamp is the ordering
export function markDisplayedBefore(
  conversations: SvelteMap<string, Conversation>,
  persistence: ConversationPersistence,
  peer: string,
  timestamp: number
): void {
  const conversation = conversations.get(bareJid(peer))
  if (!conversation) return
  for (const m of conversation.messages) {
    if (!m.outgoing && !m.read && m.timestamp <= timestamp) m.read = true
  }
  conversation.unread = conversation.messages.filter((m) => !m.outgoing && !m.read).length
  persistence.schedule(conversation)
}

// Dedup on every candidate id a stanza can carry: a live delivery has
// no stanza-id while its MAM copy adds the archive id.
export function isDuplicate(seen: Map<string, Set<string>>, peer: string, ids: string[]): boolean {
  let set = seen.get(peer)
  if (!set) {
    set = new Set()
    seen.set(peer, set)
  }
  if (ids.some((id) => set.has(id))) return true
  for (const id of ids) set.add(id)
  if (set.size > DEDUP_CAP) {
    // drop the oldest entries. Set iterates in insertion order
    for (const old of set) {
      if (set.size <= DEDUP_CAP) break
      set.delete(old)
    }
  }
  return false
}

// One splice so reactivity notifies once for the whole batch. Pending
// uploads left no wire trace and expired ephemeral rows never hydrate
// back.
export async function hydrateConversation(
  persistence: ConversationPersistence,
  seen: Map<string, Set<string>>,
  conversation: Conversation
): Promise<void> {
  const stored = await persistence.load(conversation.peerJid)
  if (!stored || conversation.messages.length > 0) return
  const seenSet = seen.get(conversation.peerJid) ?? new Set<string>()
  seen.set(conversation.peerJid, seenSet)
  const batch: ChatMessage[] = []
  for (const raw of stored) {
    // older caches lack newer fields
    raw.reactions ??= {}
    if (raw.pending) continue
    if (raw.expiresAt !== undefined && raw.expiresAt <= Date.now()) continue
    batch.push(raw)
    if (seenSet.size < DEDUP_CAP) {
      for (const id of raw.dedupIds ?? [raw.id]) seenSet.add(id)
    }
  }
  conversation.messages.splice(0, 0, ...batch)
}

// Bound the live list. Called only on tail appends: archive pages land
// at the front and must not evict themselves. Dropped ids leave the
// dedup set too, so scroll-back refetches of trimmed history are not
// swallowed as duplicates.
export function trimLive(conversation: Conversation, dedup: Set<string> | undefined): void {
  const excess = conversation.messages.length - LIVE_MESSAGE_CAP
  if (excess <= 0) return
  const dropped = conversation.messages.splice(0, excess)
  if (!dedup) return
  for (const message of dropped) {
    for (const id of message.dedupIds ?? [message.id]) dedup.delete(id)
  }
}
