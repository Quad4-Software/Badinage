import { describe, expect, it } from 'vitest'

import { createConversation, emptyMessage } from './conversation.svelte'

describe('createConversation', () => {
  it('starts empty with the given peer and kind', () => {
    const conversation = createConversation('peer@example.net', 'dm')
    expect(conversation.peerJid).toBe('peer@example.net')
    expect(conversation.kind).toBe('dm')
    expect(conversation.messages).toEqual([])
    expect(conversation.unread).toBe(0)
    expect(conversation.peerState).toBeUndefined()
    expect(conversation.occupants.size).toBe(0)
    expect(conversation.typers.size).toBe(0)
  })

  it('accepts the muc kind', () => {
    const conversation = createConversation('room@conference.example.net', 'muc')
    expect(conversation.kind).toBe('muc')
    expect(conversation.joined).toBeUndefined()
    expect(conversation.ourNick).toBeUndefined()
  })
})

describe('emptyMessage', () => {
  it('builds an outgoing blank message scaffold', () => {
    const message = emptyMessage('peer@example.net')
    expect(message.peerJid).toBe('peer@example.net')
    expect(message.outgoing).toBe(true)
    expect(message.body).toBe('')
    expect(message.reactions).toEqual({})
    expect(message.read).toBe(false)
  })
})
