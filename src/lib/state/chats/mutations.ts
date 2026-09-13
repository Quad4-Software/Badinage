// Local mutations on stored conversation rows: delivery-error marks,
// retractions, corrections, reactions, message removal and history
// wipes. Free functions over the store's internals so chats.svelte.ts
// stays under the size gate.

import type { SvelteMap } from 'svelte/reactivity'

import type { IncomingMessage } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

import type { ConversationPersistence } from '../persistence.svelte'
import type { ChatMessage, Conversation } from '../conversation.svelte'
import { applyCorrection, applyReactions, applyRetraction } from '../messages'

// find a stored message by wire id (what remote references in
// reply/replace/reactions) or by our dedup id
export function findIn(
  conversations: SvelteMap<string, Conversation>,
  peer: string,
  ref: string
): ChatMessage | undefined {
  const messages = conversations.get(bareJid(peer))?.messages
  return messages?.find((m) => m.wireId === ref || m.id === ref)
}

// type=error bounces: mark the outgoing message they reference and
// consume the stanza - its echoed payload never becomes a row, so a
// forged error cannot inject body text or bump unread. Returns true
// whenever the stanza was an error, even with no matching target.
export function applyDeliveryError(
  conversations: SvelteMap<string, Conversation>,
  persistence: ConversationPersistence,
  conversation: Conversation,
  peer: string,
  message: IncomingMessage
): boolean {
  if (message.error === undefined) return false
  const target = message.id ? findIn(conversations, peer, message.id) : undefined
  if (target?.outgoing) {
    target.deliveryError = message.error.condition ?? 'error'
    persistence.schedule(conversation)
  }
  return true
}

// Optimistic local apply for a retraction we just sent ourselves. The
// wire-side sender check is unnecessary here.
export function retractStored(
  conversations: SvelteMap<string, Conversation>,
  persistence: ConversationPersistence,
  peer: string,
  targetId: string
): void {
  const target = findIn(conversations, peer, targetId)
  if (!target) return
  applyRetraction(target)
  const conversation = conversations.get(bareJid(peer))
  if (conversation) persistence.schedule(conversation)
}

// Local-only wipe of one conversation: drops every stored row and the
// unread count, persists the emptied snapshot. Nothing reaches the
// wire - the archive and the peer keep their copies.
export function clearConversation(
  conversations: SvelteMap<string, Conversation>,
  persistence: ConversationPersistence,
  peerJid: string
): void {
  const conversation = conversations.get(bareJid(peerJid))
  if (!conversation) return
  conversation.messages.splice(0)
  conversation.unread = 0
  persistence.schedule(conversation)
}

// Drop a message row outright. Used for pending uploads that get
// cancelled or fail: nothing reached the wire, so no tombstone.
export function dropMessage(
  conversations: SvelteMap<string, Conversation>,
  persistence: ConversationPersistence,
  peer: string,
  id: string
): void {
  const conversation = conversations.get(bareJid(peer))
  if (!conversation) return
  const index = conversation.messages.findIndex((m) => m.id === id)
  if (index === -1) return
  conversation.messages.splice(index, 1)
  persistence.schedule(conversation)
}

export function reactStored(
  conversations: SvelteMap<string, Conversation>,
  peer: string,
  sender: string,
  targetId: string,
  emojis: string[]
): void {
  const target = findIn(conversations, peer, targetId)
  if (target) applyReactions(target, sender, emojis)
}

export function correctStored(
  conversations: SvelteMap<string, Conversation>,
  peer: string,
  replaceId: string,
  body: string,
  spoilerHint?: string | undefined
): boolean {
  const target = findIn(conversations, peer, replaceId)
  if (!target) return false
  applyCorrection(target, body, spoilerHint)
  return true
}
