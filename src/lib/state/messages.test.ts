import { describe, expect, it } from 'vitest'

import type { ChatMessage } from './conversation.svelte'
import { applyCorrection, applyReactions } from './messages'

const THUMBS_UP = '\u{1F44D}'
const HEART = '\u2764'

function message(reactions: Record<string, string[]> = {}): ChatMessage {
  return {
    id: 'm1',
    peerJid: 'peer@example.net',
    body: 'hi',
    outgoing: false,
    timestamp: 1,
    encrypted: false,
    delivered: false,
    read: false,
    reactions
  }
}

describe('applyReactions', () => {
  it('adds a sender under each new emoji', () => {
    const target = message()
    applyReactions(target, 'peer@example.net', [THUMBS_UP, HEART])
    expect(target.reactions).toEqual({
      [THUMBS_UP]: ['peer@example.net'],
      [HEART]: ['peer@example.net']
    })
  })

  it('replaces the sender previous set rather than accumulating', () => {
    const target = message({ [THUMBS_UP]: ['peer@example.net'] })
    applyReactions(target, 'peer@example.net', [HEART])
    expect(target.reactions).toEqual({ [HEART]: ['peer@example.net'] })
  })

  it('retracts all reactions of the sender on an empty set', () => {
    const target = message({
      [THUMBS_UP]: ['peer@example.net', 'other@example.net'],
      [HEART]: ['peer@example.net']
    })
    applyReactions(target, 'peer@example.net', [])
    expect(target.reactions).toEqual({ [THUMBS_UP]: ['other@example.net'] })
  })

  it('leaves other senders untouched', () => {
    const target = message({ [THUMBS_UP]: ['other@example.net'] })
    applyReactions(target, 'peer@example.net', [THUMBS_UP])
    expect(target.reactions[THUMBS_UP]).toEqual(['other@example.net', 'peer@example.net'])
  })

  it('does not list a sender twice for the same emoji', () => {
    const target = message({ [THUMBS_UP]: ['peer@example.net'] })
    applyReactions(target, 'peer@example.net', [THUMBS_UP])
    expect(target.reactions[THUMBS_UP]).toEqual(['peer@example.net'])
  })
})

describe('applyCorrection', () => {
  it('replaces the body and marks the message edited', () => {
    const target = message()
    applyCorrection(target, 'fixed text')
    expect(target.body).toBe('fixed text')
    expect(target.edited).toBe(true)
  })
})
