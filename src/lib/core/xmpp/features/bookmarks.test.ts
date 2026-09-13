import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it, vi } from 'vitest'

import { NS } from '../ns'
import { parseBookmark, type Bookmark } from '../stanzas'
import { bookmarkPayload, fetchBookmarks, publishBookmark, retractBookmark } from './bookmarks'
import type { StanzaBuilder, XmppTransport } from './transport'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  return doc as unknown as Element
}

interface IqCall {
  stanza: StanzaBuilder
  onResult: (stanza: Element) => void
  onError: (stanza: Element | null) => void
}

function makeTransport(): { conn: XmppTransport; iqs: IqCall[] } {
  const iqs: IqCall[] = []
  const conn: XmppTransport = {
    sendIq: (stanza, onResult, onError) => {
      iqs.push({ stanza, onResult, onError: onError ?? (() => undefined) })
    },
    send: () => undefined,
    uniqueId: (prefix) => `${prefix}-1`,
    jid: 'me@example.net/res'
  }
  return { conn, iqs }
}

// round-trip helper: wrap a serialized payload in its pubsub item and
// parse it back
function roundTrip(bookmark: Bookmark): Bookmark | null {
  return parseBookmark(xml(`<item id="${bookmark.jid}">${bookmarkPayload(bookmark)}</item>`))
}

describe('bookmarkPayload', () => {
  it('serializes a conference bookmark per XEP-0402', () => {
    const bookmark: Bookmark = {
      jid: 'room@conference.example.net',
      kind: 'conference',
      name: 'The Room',
      autojoin: true,
      nick: 'me',
      password: 's3cret'
    }
    expect(roundTrip(bookmark)).toEqual(bookmark)
  })

  it('serializes a contact bookmark', () => {
    const bookmark: Bookmark = {
      jid: 'friend@example.net',
      kind: 'contact',
      name: 'Friend'
    }
    expect(roundTrip(bookmark)).toEqual(bookmark)
  })

  it('omits autojoin when false and drops unset optional fields', () => {
    const payload = bookmarkPayload({ jid: 'r@conference.x', kind: 'conference' })
    expect(payload).not.toContain('autojoin')
    expect(payload).not.toContain('<nick')
    expect(roundTrip({ jid: 'r@conference.x', kind: 'conference' })).toEqual({
      jid: 'r@conference.x',
      kind: 'conference',
      name: undefined,
      autojoin: false,
      nick: undefined,
      password: undefined
    })
  })

  it('escapes special characters in names and nicks', () => {
    const bookmark: Bookmark = {
      jid: 'r@conference.x',
      kind: 'conference',
      name: 'a"b<c>&',
      nick: 'm&e'
    }
    const payload = bookmarkPayload(bookmark)
    expect(payload).toContain('a&quot;b&lt;c&gt;&amp;')
    const parsed = roundTrip(bookmark)
    expect(parsed?.name).toBe('a"b<c>&')
    expect(parsed?.nick).toBe('m&e')
  })
})

describe('publishBookmark', () => {
  it('sends publish plus publish-options required by XEP-0402', () => {
    const { conn, iqs } = makeTransport()
    const done = vi.fn()
    publishBookmark(
      conn,
      { jid: 'room@conference.x', kind: 'conference', autojoin: true, nick: 'me' },
      done
    )
    expect(iqs).toHaveLength(1)
    const wire = String(iqs[0]?.stanza)
    // item id is the bookmarked jid, payload lives under publish
    expect(wire).toContain('<item id="room@conference.x"')
    expect(wire).toContain(`xmlns="${NS.BOOKMARKS}"`)
    expect(wire).toContain('autojoin="true"')
    // XEP-0402 section 3.3: publish-options sibling of publish under pubsub
    expect(wire.indexOf('</publish>')).toBeLessThan(wire.indexOf('<publish-options>'))
    expect(wire).toContain(NS.PUBSUB_PUBLISH_OPTIONS)
    expect(wire).toContain('pubsub#persist_items')
    expect(wire).toContain('pubsub#max_items')
    expect(wire).toContain('<value>max</value>')
    expect(wire).toContain('pubsub#access_model')
    expect(wire).toContain('<value>whitelist</value>')
    expect(wire).toContain('pubsub#send_last_published_item')
    expect(wire).toContain('<value>never</value>')

    iqs[0]?.onResult(xml(`<iq type="result"/>`))
    expect(done).toHaveBeenCalledWith(true)
  })

  it('reports failure through onDone', () => {
    const { conn, iqs } = makeTransport()
    const done = vi.fn()
    publishBookmark(conn, { jid: 'r@c.x', kind: 'conference' }, done)
    iqs[0]?.onError(xml(`<iq type="error"><error type="cancel"><not-allowed/></error></iq>`))
    expect(done).toHaveBeenCalledWith(false)
  })
})

describe('retractBookmark', () => {
  it('sends a retract for the item id', () => {
    const { conn, iqs } = makeTransport()
    const done = vi.fn()
    retractBookmark(conn, 'room@conference.x', done)
    const wire = String(iqs[0]?.stanza)
    expect(wire).toContain(`<retract node="${NS.BOOKMARKS}"`)
    expect(wire).toContain('notify="true"')
    expect(wire).toContain('<item id="room@conference.x"')
    iqs[0]?.onResult(xml(`<iq type="result"/>`))
    expect(done).toHaveBeenCalledWith(true)
  })
})

describe('fetchBookmarks', () => {
  it('parses the items result into bookmarks', () => {
    const { conn, iqs } = makeTransport()
    const done = vi.fn()
    fetchBookmarks(conn, done)
    expect(String(iqs[0]?.stanza)).toContain(`node="${NS.BOOKMARKS}"`)
    iqs[0]?.onResult(
      xml(`<iq type="result"><pubsub xmlns="${NS.PUBSUB}">
        <items node="${NS.BOOKMARKS}">
          <item id="room@conference.x">
            <conference xmlns="${NS.BOOKMARKS}" autojoin="true"><nick>me</nick></conference>
          </item>
          <item id="friend@example.net">
            <contact xmlns="${NS.BOOKMARKS}" name="Friend"/>
          </item>
        </items>
      </pubsub></iq>`)
    )
    expect(done).toHaveBeenCalledWith([
      expect.objectContaining({ jid: 'room@conference.x', kind: 'conference', autojoin: true }),
      expect.objectContaining({ jid: 'friend@example.net', kind: 'contact', name: 'Friend' })
    ])
  })

  it('resolves null when the server lacks PEP', () => {
    const { conn, iqs } = makeTransport()
    const done = vi.fn()
    fetchBookmarks(conn, done)
    iqs[0]?.onError(
      xml(`<iq type="error"><error type="cancel"><feature-not-implemented/></error></iq>`)
    )
    expect(done).toHaveBeenCalledWith(null)
  })
})
