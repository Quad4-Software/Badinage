import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAT_STATE_TTL_MS } from '$lib/constants'

import type { Conversation } from './conversation.svelte'
import { TypingTracker } from './typing'

// TypingTracker only touches peerJid, kind, peerState and typers, so a
// plain object with the same surface stands in for the reactive model
function fakeConversation(kind: 'dm' | 'muc'): Conversation {
  return {
    peerJid: 'peer@example.net',
    kind,
    messages: [],
    unread: 0,
    occupants: new Map(),
    typers: new Set()
  } as unknown as Conversation
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TypingTracker dm', () => {
  it('expires a stale composing state after the ttl', () => {
    const tracker = new TypingTracker()
    const conversation = fakeConversation('dm')
    conversation.peerState = 'composing'
    tracker.note(conversation, '', 'composing')

    vi.advanceTimersByTime(CHAT_STATE_TTL_MS - 1)
    expect(conversation.peerState).toBe('composing')

    vi.advanceTimersByTime(1)
    expect(conversation.peerState).toBe('paused')
  })

  it('restarts the expiry when the peer keeps composing', () => {
    const tracker = new TypingTracker()
    const conversation = fakeConversation('dm')
    conversation.peerState = 'composing'
    tracker.note(conversation, '', 'composing')

    vi.advanceTimersByTime(CHAT_STATE_TTL_MS - 1)
    tracker.note(conversation, '', 'composing')
    vi.advanceTimersByTime(CHAT_STATE_TTL_MS - 1)
    expect(conversation.peerState).toBe('composing')

    vi.advanceTimersByTime(1)
    expect(conversation.peerState).toBe('paused')
  })

  it('clears a composing state on a non-composing update', () => {
    const tracker = new TypingTracker()
    const conversation = fakeConversation('dm')
    conversation.peerState = 'composing'
    tracker.note(conversation, '', 'composing')
    tracker.note(conversation, '', 'active')
    expect(conversation.peerState).toBe('paused')

    vi.advanceTimersByTime(CHAT_STATE_TTL_MS * 2)
    expect(conversation.peerState).toBe('paused')
  })

  it('leaves a non-composing peer state alone', () => {
    const tracker = new TypingTracker()
    const conversation = fakeConversation('dm')
    conversation.peerState = 'gone'
    tracker.note(conversation, '', 'active')
    vi.advanceTimersByTime(CHAT_STATE_TTL_MS * 2)
    expect(conversation.peerState).toBe('gone')
  })
})

describe('TypingTracker muc', () => {
  it('tracks typers per nick and expires them', () => {
    const tracker = new TypingTracker()
    const conversation = fakeConversation('muc')
    tracker.note(conversation, 'nick1', 'composing')
    tracker.note(conversation, 'nick2', 'composing')
    expect([...conversation.typers].sort()).toEqual(['nick1', 'nick2'])

    vi.advanceTimersByTime(CHAT_STATE_TTL_MS)
    expect(conversation.typers.size).toBe(0)
  })

  it('removes a typer on a non-composing state', () => {
    const tracker = new TypingTracker()
    const conversation = fakeConversation('muc')
    tracker.note(conversation, 'nick1', 'composing')
    tracker.note(conversation, 'nick1', 'paused')
    expect(conversation.typers.has('nick1')).toBe(false)
  })

  it('ignores states without a sender nick', () => {
    const tracker = new TypingTracker()
    const conversation = fakeConversation('muc')
    tracker.note(conversation, '', 'composing')
    expect(conversation.typers.size).toBe(0)
  })
})
