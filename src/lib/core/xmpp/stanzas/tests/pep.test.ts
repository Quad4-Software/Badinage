import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import {
  parseBookmark,
  parseBookmarkItems,
  parseChannelSearchItems,
  parseMdsItem,
  parsePepEvent
} from '..'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  // xmldom's Element type is structural enough for the parser functions
  return doc as unknown as Element
}
describe('parsePepEvent', () => {
  it('extracts node, items and retracts from a pubsub event', () => {
    const event = parsePepEvent(
      xml(`<message from="me@example.net" type="headline">
        <event xmlns="http://jabber.org/protocol/pubsub#event">
          <items node="urn:xmpp:bookmarks:1">
            <item id="room@conference.example.net">
              <conference xmlns="urn:xmpp:bookmarks:1" autojoin="true"><nick>me</nick></conference>
            </item>
            <retract id="old@conference.example.net"/>
          </items>
        </event>
      </message>`)
    )
    expect(event?.node).toBe('urn:xmpp:bookmarks:1')
    expect(event?.items).toHaveLength(1)
    expect(event?.retracted).toEqual(['old@conference.example.net'])
  })

  it('returns null on a plain message', () => {
    expect(parsePepEvent(xml(`<message from="a@b.c"><body>hi</body></message>`))).toBeNull()
  })
})

describe('parseBookmark', () => {
  it('parses a conference item', () => {
    const bookmark = parseBookmark(
      xml(`<item id="room@conference.example.net">
        <conference xmlns="urn:xmpp:bookmarks:1" name="Room" autojoin="true">
          <nick>me</nick><password>s3cret</password>
        </conference>
      </item>`)
    )
    expect(bookmark).toEqual({
      jid: 'room@conference.example.net',
      kind: 'conference',
      name: 'Room',
      autojoin: true,
      nick: 'me',
      password: 's3cret'
    })
  })

  it('parses a contact item', () => {
    const bookmark = parseBookmark(
      xml(`<item id="friend@example.net">
        <contact xmlns="urn:xmpp:bookmarks:1" name="Friend"/>
      </item>`)
    )
    expect(bookmark).toEqual({
      jid: 'friend@example.net',
      kind: 'contact',
      name: 'Friend'
    })
  })

  it('returns null for unknown payloads', () => {
    expect(parseBookmark(xml(`<item id="x"><other/></item>`))).toBeNull()
  })
})

describe('parseBookmarkItems', () => {
  it('collects bookmark items and drops jid-less entries', () => {
    const bookmarks = parseBookmarkItems(
      xml(`<items node="urn:xmpp:bookmarks:1">
        <item id="a@conference.x"><conference xmlns="urn:xmpp:bookmarks:1"/></item>
        <item><conference xmlns="urn:xmpp:bookmarks:1"/></item>
      </items>`)
    )
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0]?.jid).toBe('a@conference.x')
  })
})

describe('parseMdsItem', () => {
  it('parses a displayed marker item', () => {
    const item = xml(`<item xmlns="http://jabber.org/protocol/pubsub" id="peer@b.c">
      <displayed xmlns="urn:xmpp:mds:displayed:0">
        <stanza-id xmlns="urn:xmpp:sid:0" id="stanza-1" by="peer@b.c"/>
      </displayed>
    </item>`)
    expect(parseMdsItem(item)).toEqual({ peer: 'peer@b.c', stanzaId: 'stanza-1', by: 'peer@b.c' })
  })

  it('returns null without a displayed child', () => {
    const item = xml(`<item xmlns="http://jabber.org/protocol/pubsub" id="peer@b.c"/>`)
    expect(parseMdsItem(item)).toBeNull()
  })
})

describe('parseChannelSearchItems', () => {
  it('parses result items with address and reported children', () => {
    const stanza = xml(`<iq type="result">
      <search xmlns="urn:xmpp:channel-search:0:search">
        <item address="room@conf.b.c">
          <name>The Room</name>
          <description>chat here</description>
          <nusers>42</nusers>
          <is-open/>
        </item>
        <item><name>no address</name></item>
      </search>
    </iq>`)
    const items = parseChannelSearchItems(stanza)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      address: 'room@conf.b.c',
      name: 'The Room',
      description: 'chat here',
      nusers: 42,
      isOpen: true
    })
  })
})
