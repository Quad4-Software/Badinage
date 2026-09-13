import { describe, expect, it } from 'vitest'

import { parseXmppUri } from '$lib/utils/protocol/xmpp-uri'

describe('parseXmppUri', () => {
  it('parses a message action with a body param', () => {
    expect(parseXmppUri('xmpp:juliet@capulet.lit?message;body=hello')).toEqual({
      jid: 'juliet@capulet.lit',
      action: 'message',
      params: { body: 'hello' }
    })
  })

  it('parses join, roster and remove actions', () => {
    expect(parseXmppUri('xmpp:room@conference.lit?join')?.action).toBe('join')
    expect(parseXmppUri('xmpp:romeo@montague.lit?roster')?.action).toBe('roster')
    expect(parseXmppUri('xmpp:spam@bad.lit?remove')?.action).toBe('remove')
    expect(parseXmppUri('xmpp:juliet@capulet.lit?subscribe')?.action).toBe('subscribe')
  })

  it('parses a bare jid with empty action and params', () => {
    expect(parseXmppUri('xmpp:juliet@capulet.lit')).toEqual({
      jid: 'juliet@capulet.lit',
      action: '',
      params: {}
    })
  })

  it('strips the authority marker form', () => {
    expect(parseXmppUri('xmpp://juliet@capulet.lit?message')?.jid).toBe('juliet@capulet.lit')
  })

  it('percent-decodes the jid and param values', () => {
    const uri = parseXmppUri('xmpp:juliet%40capulet.lit?message;body=hi%20there%20%F0%9F%98%BA')
    expect(uri?.jid).toBe('juliet@capulet.lit')
    expect(uri?.params.body).toBe('hi there \u{1f63a}')
  })

  it('keeps several params alongside the action', () => {
    const uri = parseXmppUri('xmpp:j@x.lit?message;subject=s;body=b;thread=t;type=chat')
    expect(uri?.params).toEqual({ subject: 's', body: 'b', thread: 't', type: 'chat' })
  })

  it('treats a bare query token as the action only', () => {
    const uri = parseXmppUri('xmpp:j@x.lit?join')
    expect(uri?.action).toBe('join')
    expect(uri?.params).toEqual({})
  })

  it('returns null for non-xmpp schemes', () => {
    expect(parseXmppUri('http://example.com')).toBeNull()
    expect(parseXmppUri('mailto:j@x.lit')).toBeNull()
    expect(parseXmppUri('')).toBeNull()
  })

  it('returns null for missing or invalid jids', () => {
    expect(parseXmppUri('xmpp:')).toBeNull()
    expect(parseXmppUri('xmpp:?message')).toBeNull()
    expect(parseXmppUri('xmpp:@capulet.lit')).toBeNull()
    expect(parseXmppUri('xmpp:juliet@')).toBeNull()
  })

  it('rejects whitespace inside the jid even when encoded', () => {
    expect(parseXmppUri('xmpp:juliet @capulet.lit')).toBeNull()
    expect(parseXmppUri('xmpp:juliet%20@capulet.lit')).toBeNull()
  })

  it('returns null on malformed percent escapes in the jid', () => {
    expect(parseXmppUri('xmpp:juliet@capulet.lit%zz')).toBeNull()
  })

  it('drops params with malformed escapes instead of failing the link', () => {
    const uri = parseXmppUri('xmpp:j@x.lit?message;body=%')
    expect(uri?.action).toBe('message')
    expect(uri?.params.body).toBeUndefined()
  })

  it('strips control characters from jid and params', () => {
    const uri = parseXmppUri('xmpp:%01juliet@capulet.lit?message;body=hi%00%07bye')
    expect(uri?.jid).toBe('juliet@capulet.lit')
    expect(uri?.params.body).toBe('hibye')
  })

  it('caps body at 2000 chars and other params at 512', () => {
    const body = 'x'.repeat(3000)
    const subject = 'y'.repeat(600)
    const uri = parseXmppUri(`xmpp:j@x.lit?message;body=${body};subject=${subject}`)
    expect(uri?.params.body).toHaveLength(2000)
    expect(uri?.params.subject).toHaveLength(512)
  })
})
