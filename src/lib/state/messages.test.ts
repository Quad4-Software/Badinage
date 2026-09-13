import { describe, expect, it } from 'vitest'

import type { ChatMessage } from './conversation.svelte'
import { applyCorrection, applyReactions, applyRetraction } from './messages'

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

  it('updates the spoiler state carried by the correction stanza', () => {
    const target = message()
    applyCorrection(target, 'still hidden', 'the hint')
    expect(target.spoilerHint).toBe('the hint')
    applyCorrection(target, 'now plain', undefined)
    expect(target.spoilerHint).toBeUndefined()
  })
})

describe('applyRetraction', () => {
  it('scrubs content and reactions but keeps the row', () => {
    const target = message({ [THUMBS_UP]: ['peer@example.net'] })
    target.attachments = [{ url: 'https://files.example.net/x.png', mediaType: 'image/png' }]
    target.replyTo = { id: 'other-1', from: 'peer@example.net' }
    target.spoilerHint = 'hint'
    applyRetraction(target)
    expect(target.id).toBe('m1')
    expect(target.retracted).toBe(true)
    expect(target.body).toBe('')
    expect(target.attachments).toBeUndefined()
    expect(target.replyTo).toBeUndefined()
    expect(target.spoilerHint).toBeUndefined()
    expect(target.reactions).toEqual({})
  })
})
