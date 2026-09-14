import { describe, expect, it } from 'vitest'

import { defaultISupport } from '../address'
import {
  banOccupant,
  inviteToRoom,
  joinRoom,
  kickOccupant,
  leaveRoom,
  moderateMessage,
  queryArchive,
  sendChatMessage,
  sendChatState,
  sendMarker,
  sendMarkread,
  sendPresence,
  sendReaction,
  sendRetraction,
  setInvisible,
  setRoomSubject,
  type IrcSend
} from '../outbound'

function makeSend(
  capList: string[] = []
): IrcSend & { lines: string[]; labels: [string, string][] } {
  const lines: string[] = []
  const labels: [string, string][] = []
  let counter = 0
  return {
    lines,
    labels,
    raw: (line) => lines.push(line),
    caps: () => new Set(capList),
    isupport: defaultISupport(),
    uniqueId: (prefix) => `${prefix}-${++counter}`,
    noteLabel: (label, peer) => labels.push([label, peer])
  }
}

const FULL_CAPS = [
  'message-tags',
  'labeled-response',
  'draft/multiline',
  'draft/read-marker',
  'draft/chathistory'
]

describe('sendChatMessage', () => {
  it('sends a single privmsg with a label', () => {
    const send = makeSend(FULL_CAPS)
    const id = sendChatMessage(send, 'alice@irc.example.org', 'hi')
    expect(id).toBe('m-1')
    expect(send.lines).toEqual(['@label=m-1 PRIVMSG alice hi'])
    expect(send.labels).toEqual([['m-1', 'alice@irc.example.org']])
  })

  it('splits overlong bodies below the wire limit', () => {
    const send = makeSend([])
    const body = 'x'.repeat(900)
    sendChatMessage(send, '#c@d', body)
    expect(send.lines).toHaveLength(3)
    for (const line of send.lines) expect(line.length).toBeLessThan(512)
  })

  it('batches a multiline body when the cap exists', () => {
    const send = makeSend(FULL_CAPS)
    sendChatMessage(send, '#c@d', 'one\ntwo')
    expect(send.lines[0]).toBe('BATCH +b-2 draft/multiline #c')
    expect(send.lines[1]).toBe('@batch=b-2;label=m-1 PRIVMSG #c one')
    expect(send.lines[2]).toBe('@batch=b-2;label=m-1 PRIVMSG #c two')
    expect(send.lines[3]).toBe('BATCH -b-2')
  })

  it('falls back to one privmsg per line without the cap', () => {
    const send = makeSend(['labeled-response'])
    sendChatMessage(send, '#c@d', 'one\ntwo')
    expect(send.lines).toEqual(['@label=m-1 PRIVMSG #c one', '@label=m-1 PRIVMSG #c two'])
  })

  it('carries reply and edit tags only with message-tags', () => {
    const tagged = makeSend(FULL_CAPS)
    sendChatMessage(tagged, '#c@d', 'fixed', {
      replaceId: 'orig',
      replyTo: { id: 'r1', from: 'a@d' }
    })
    expect(tagged.lines[0]).toContain('+draft/reply=r1')
    expect(tagged.lines[0]).toContain('+draft/edit=orig')
    const plain = makeSend([])
    sendChatMessage(plain, '#c@d', 'fixed', { replaceId: 'orig' })
    expect(plain.lines[0]).toBe('PRIVMSG #c fixed')
  })
})

describe('sendReaction', () => {
  const reacted = new Map<string, Set<string>>()

  it('sends a react tagmsg for new emojis only', () => {
    const send = makeSend(FULL_CAPS)
    sendReaction(send, reacted, '#c@d', 'm1', ['👍'])
    sendReaction(send, reacted, '#c@d', 'm1', ['👍', '❤️'])
    expect(send.lines).toHaveLength(2)
    expect(send.lines[0]).toContain('+draft/react=👍')
    expect(send.lines[1]).toContain('+draft/react=❤️')
    expect(send.lines[1]).not.toContain('👍')
  })

  it('sends an unreact for removed emojis', () => {
    const send = makeSend(FULL_CAPS)
    sendReaction(send, reacted, '#c2@d', 'm2', ['👍'])
    sendReaction(send, reacted, '#c2@d', 'm2', [])
    expect(send.lines.at(-1)).toContain('+draft/unreact=👍')
  })

  it('does nothing without message-tags', () => {
    const send = makeSend([])
    sendReaction(send, reacted, '#c3@d', 'm3', ['👍'])
    expect(send.lines).toHaveLength(0)
  })
})

describe('tag-only sends', () => {
  it('maps chat states to typing tags', () => {
    const send = makeSend(FULL_CAPS)
    sendChatState(send, 'a@d', 'composing')
    sendChatState(send, 'a@d', 'paused')
    sendChatState(send, 'a@d', 'gone')
    expect(send.lines.map((l) => l.split(' ')[0])).toEqual([
      '@+typing=active',
      '@+typing=paused',
      '@+typing=done'
    ])
  })

  it('maps retractions and moderation to delete tags', () => {
    const send = makeSend(FULL_CAPS)
    sendRetraction(send, 'a@d', 'm1')
    moderateMessage(send, '#c@d', 'm2')
    expect(send.lines[0]).toContain('+draft/delete=m1')
    expect(send.lines[1]).toContain('+draft/delete=m2')
  })

  it('sends markread only for displayed with the cap', () => {
    const send = makeSend(FULL_CAPS)
    sendMarker(send, 'a@d', 'displayed')
    sendMarker(send, 'a@d', 'received')
    expect(send.lines).toHaveLength(1)
    expect(send.lines[0]).toMatch(/^MARKREAD a timestamp=/)
    expect(sendMarkread(send, 'a@d')).toBe(true)
    const nocap = makeSend([])
    expect(sendMarkread(nocap, 'a@d')).toBe(false)
    expect(nocap.lines).toHaveLength(0)
  })
})

describe('room commands', () => {
  it('renames before joining under a different nick', () => {
    const send = makeSend([])
    joinRoom(send, 'me', '#c@d', 'other')
    expect(send.lines).toEqual(['NICK other', 'JOIN #c'])
    joinRoom(send, 'me2', '#c@d', 'me2', 'key1')
    expect(send.lines.at(-1)).toBe('JOIN #c key1')
  })

  it('emits the matching wire commands', () => {
    const send = makeSend([])
    leaveRoom(send, '#c@d')
    setRoomSubject(send, '#c@d', 'topic here')
    kickOccupant(send, '#c@d', 'troll', 'why')
    banOccupant(send, '#c@d', 'troll@d')
    inviteToRoom(send, '#c@d', 'friend@d')
    expect(send.lines).toEqual([
      'PART #c',
      'TOPIC #c :topic here',
      'KICK #c troll :why',
      'MODE #c +b troll!*@*',
      'INVITE friend #c'
    ])
  })
})

describe('presence and archive', () => {
  it('maps presence shows to away commands', () => {
    const send = makeSend([])
    sendPresence(send, 'online')
    sendPresence(send, 'away', 'lunch')
    sendPresence(send, 'dnd')
    expect(send.lines).toEqual(['AWAY', 'AWAY :lunch', 'AWAY :dnd'])
  })

  it('toggles user mode +i for invisibility', () => {
    const send = makeSend([])
    setInvisible(send, 'me', true)
    setInvisible(send, 'me', false)
    expect(send.lines).toEqual(['MODE me +i', 'MODE me -i'])
  })

  it('emits latest and before chathistory queries', () => {
    const send = makeSend([])
    queryArchive(send, '#c@d', undefined, 50)
    queryArchive(send, 'a@d', 'm9', 25)
    expect(send.lines).toEqual(['CHATHISTORY LATEST #c * 50', 'CHATHISTORY BEFORE a msgid=m9 25'])
  })
})

describe('label bookkeeping', () => {
  it('does not label sends without labeled-response', () => {
    const send = makeSend(['message-tags'])
    sendChatMessage(send, 'a@d', 'hi')
    expect(send.lines[0]).toBe('PRIVMSG a hi')
    expect(send.labels).toHaveLength(1)
  })
})
