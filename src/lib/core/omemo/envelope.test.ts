import { describe, expect, it } from 'vitest'

import { NS } from '$lib/core/xmpp/ns'
import type { IncomingMessage } from '$lib/core/xmpp/stanzas'

import {
  applyEnvelopeContent,
  attachmentNodes,
  chatStateNode,
  reactionsNode,
  replaceNode,
  replyNode
} from './envelope'

const baseMessage = (): IncomingMessage => ({
  from: 'romeo@example.net/phone',
  to: 'juliet@example.net',
  body: 'fallback',
  type: 'chat'
})

describe('envelope node builders', () => {
  it('builds a XEP-0461 reply reference', () => {
    const node = replyNode({ id: 'm-1', to: 'romeo@example.net' })
    expect(node.name).toBe('reply')
    expect(node.attrs['xmlns']).toBe(NS.REPLY)
    expect(node.attrs['id']).toBe('m-1')
    expect(node.attrs['to']).toBe('romeo@example.net')
  })

  it('builds a XEP-0308 replace reference', () => {
    const node = replaceNode('m-2')
    expect(node.name).toBe('replace')
    expect(node.attrs['xmlns']).toBe(NS.CORRECT)
    expect(node.attrs['id']).toBe('m-2')
  })

  it('builds a XEP-0444 reactions node with one child per emoji', () => {
    const node = reactionsNode('m-3', ['👍', '❤️'])
    expect(node.name).toBe('reactions')
    expect(node.attrs['xmlns']).toBe(NS.REACTIONS)
    expect(node.attrs['id']).toBe('m-3')
    expect(node.children.map((c) => c.name)).toEqual(['reaction', 'reaction'])
    expect(node.children.map((c) => c.text)).toEqual(['👍', '❤️'])
  })

  it('builds a XEP-0085 chat state node', () => {
    const node = chatStateNode('composing')
    expect(node.name).toBe('composing')
    expect(node.attrs['xmlns']).toBe(NS.CHAT_STATES)
  })

  it('builds oob plus file metadata nodes', () => {
    const nodes = attachmentNodes('aesgcm://f.example/x#aa', {
      name: 'pic.png',
      mediaType: 'image/png',
      size: 42,
      duration: 3
    })
    expect(nodes).toHaveLength(2)
    expect(nodes[0]?.name).toBe('x')
    expect(nodes[0]?.attrs['xmlns']).toBe(NS.OOB)
    expect(nodes[1]?.name).toBe('file')
    expect(nodes[1]?.attrs['xmlns']).toBe(NS.FILE_METADATA)
  })

  it('omits the file node when no metadata is given', () => {
    expect(attachmentNodes('https://f.example/x')).toHaveLength(1)
  })
})

describe('applyEnvelopeContent', () => {
  it('maps reply, replace, reactions and chat state onto the message', () => {
    const message = baseMessage()
    applyEnvelopeContent(message, [
      replyNode({ id: 'm-1', to: 'romeo@example.net' }),
      replaceNode('m-2'),
      reactionsNode('m-3', ['👍']),
      chatStateNode('paused')
    ])
    expect(message.replyTo).toEqual({ id: 'm-1', from: 'romeo@example.net' })
    expect(message.replaceId).toBe('m-2')
    expect(message.reactionTo).toEqual({ id: 'm-3', emojis: ['👍'] })
    expect(message.chatState).toBe('paused')
  })

  it('maps oob url plus file metadata onto attachments', () => {
    const message = baseMessage()
    applyEnvelopeContent(
      message,
      attachmentNodes('aesgcm://f.example/x#aa', {
        name: 'doc.pdf',
        mediaType: 'application/pdf',
        size: 1024
      })
    )
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments?.[0]).toMatchObject({
      url: 'aesgcm://f.example/x#aa',
      mediaType: 'application/pdf',
      name: 'doc.pdf',
      size: 1024
    })
  })

  it('ignores foreign elements and unknown chat-state names', () => {
    const message = baseMessage()
    applyEnvelopeContent(message, [
      { name: 'composing', attrs: { xmlns: 'urn:other' }, children: [], text: '' },
      { name: 'whatever', attrs: {}, children: [], text: '' }
    ])
    expect(message.chatState).toBeUndefined()
    expect(message.replyTo).toBeUndefined()
    expect(message.attachments).toBeUndefined()
  })

  it('drops non-numeric file metadata instead of failing', () => {
    const message = baseMessage()
    applyEnvelopeContent(message, [
      {
        name: 'x',
        attrs: { xmlns: NS.OOB },
        children: [{ name: 'url', attrs: {}, children: [], text: 'https://f.example/a' }],
        text: ''
      },
      {
        name: 'file',
        attrs: { xmlns: NS.FILE_METADATA },
        children: [{ name: 'size', attrs: {}, children: [], text: 'lots' }],
        text: ''
      }
    ])
    expect(message.attachments?.[0]?.url).toBe('https://f.example/a')
    expect(message.attachments?.[0]?.size).toBeUndefined()
  })
})
