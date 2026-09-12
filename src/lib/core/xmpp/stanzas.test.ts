import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { parseMessage, parsePresence, parseRosterItems } from './stanzas'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  // xmldom's Element type is structural enough for the parser functions
  return doc as unknown as Element
}

describe('parseMessage', () => {
  it('parses a basic chat message', () => {
    const m = parseMessage(
      xml(`<message from="romeo@example.net/phone" to="me@example.net" type="chat" id="m1">
        <body>hello</body>
      </message>`)
    )
    expect(m).toMatchObject({
      from: 'romeo@example.net/phone',
      to: 'me@example.net',
      body: 'hello',
      type: 'chat',
      id: 'm1'
    })
  })

  it('parses stanza-id, origin-id and delay', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>hi</body>
        <stanza-id xmlns="urn:xmpp:sid:0" id="sid-1" by="b.c"/>
        <origin-id xmlns="urn:xmpp:sid:0" id="oid-1"/>
        <delay xmlns="urn:xmpp:delay" stamp="2024-01-01T12:00:00Z"/>
      </message>`)
    )
    expect(m?.stanzaId).toBe('sid-1')
    expect(m?.originId).toBe('oid-1')
    expect(m?.delay).toBe(Date.parse('2024-01-01T12:00:00Z'))
  })

  it('unwraps a received carbon', () => {
    const m = parseMessage(
      xml(`<message from="me@example.net" to="me@example.net/home">
        <received xmlns="urn:xmpp:carbons:2">
          <forwarded xmlns="urn:xmpp:forward:0">
            <message from="peer@example.net/x" to="me@example.net" type="chat">
              <body>carbon copy</body>
            </message>
          </forwarded>
        </received>
      </message>`)
    )
    expect(m?.carbon).toBe('received')
    expect(m?.from).toBe('peer@example.net/x')
    expect(m?.body).toBe('carbon copy')
  })

  it('unwraps a sent carbon', () => {
    const m = parseMessage(
      xml(`<message from="me@example.net" to="me@example.net/home">
        <sent xmlns="urn:xmpp:carbons:2">
          <forwarded xmlns="urn:xmpp:forward:0">
            <message from="me@example.net/phone" to="peer@example.net" type="chat">
              <body>i said this</body>
            </message>
          </forwarded>
        </sent>
      </message>`)
    )
    expect(m?.carbon).toBe('sent')
    expect(m?.to).toBe('peer@example.net')
  })

  it('unwraps a MAM result', () => {
    const m = parseMessage(
      xml(`<message from="me@example.net" to="me@example.net/home">
        <result xmlns="urn:xmpp:mam:2" queryid="q1" id="archive-1">
          <forwarded xmlns="urn:xmpp:forward:0">
            <delay xmlns="urn:xmpp:delay" stamp="2024-02-02T10:00:00Z"/>
            <message from="peer@example.net" to="me@example.net" type="chat">
              <body>from the archive</body>
            </message>
          </forwarded>
        </result>
      </message>`)
    )
    expect(m?.mam).toBe(true)
    expect(m?.body).toBe('from the archive')
    expect(m?.delay).toBe(Date.parse('2024-02-02T10:00:00Z'))
  })

  it('parses chat states without a body', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <composing xmlns="http://jabber.org/protocol/chatstates"/>
      </message>`)
    )
    expect(m?.chatState).toBe('composing')
    expect(m?.body).toBe('')
  })

  it('parses receipt requests and receipts', () => {
    const request = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat" id="m9">
        <body>ping</body>
        <request xmlns="urn:xmpp:receipts"/>
      </message>`)
    )
    expect(request?.receiptRequest).toBe(true)

    const receipt = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <received xmlns="urn:xmpp:receipts" id="m9"/>
      </message>`)
    )
    expect(receipt?.receiptFor).toBe('m9')
  })

  it('parses chat markers', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <displayed xmlns="urn:xmpp:chat-markers:0" id="m9"/>
      </message>`)
    )
    expect(m?.marker).toEqual({ id: 'm9', type: 'displayed' })
  })

  it('parses groupchat messages with nick and subject', () => {
    const m = parseMessage(
      xml(`<message from="room@conference.x.y/nick1" to="x@y.z" type="groupchat">
        <body>room msg</body>
      </message>`)
    )
    expect(m?.type).toBe('groupchat')
    expect(m?.nick).toBe('nick1')

    const subject = parseMessage(
      xml(`<message from="room@conference.x.y" to="x@y.z" type="groupchat">
        <subject>topic here</subject>
      </message>`)
    )
    expect(subject?.subject).toBe('topic here')
  })

  it('parses a reply and strips the quote fallback from the body', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <reply xmlns="urn:xmpp:reply:0" id="orig-1" to="a@b.c"/>
        <body>&gt; original text
&gt; second quoted line
my answer</body>
      </message>`)
    )
    expect(m?.replyTo).toEqual({
      id: 'orig-1',
      from: 'a@b.c',
      quote: 'original text\nsecond quoted line'
    })
    expect(m?.body).toBe('my answer')
  })

  it('leaves a plain quoted body alone without a reply element', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>&gt; not a reply fallback</body>
      </message>`)
    )
    expect(m?.replyTo).toBeUndefined()
    expect(m?.body).toBe('> not a reply fallback')
  })

  it('parses reactions with and without a body', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <reactions xmlns="urn:xmpp:reactions:0" id="target-1">
          <reaction>&#128077;</reaction>
          <reaction>&#10084;</reaction>
        </reactions>
      </message>`)
    )
    expect(m?.reactionTo).toEqual({ id: 'target-1', emojis: ['\u{1F44D}', '\u2764'] })

    const retract = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <reactions xmlns="urn:xmpp:reactions:0" id="target-1"/>
      </message>`)
    )
    expect(retract?.reactionTo).toEqual({ id: 'target-1', emojis: [] })
  })

  it('parses a last message correction', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>fixed text</body>
        <replace xmlns="urn:xmpp:message-correct:0" id="orig-1"/>
      </message>`)
    )
    expect(m?.replaceId).toBe('orig-1')
    expect(m?.body).toBe('fixed text')
  })

  it('parses an OOB attachment with file metadata', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>https://files.example.net/pic.jpg</body>
        <x xmlns="jabber:x:oob"><url>https://files.example.net/pic.jpg</url></x>
        <file xmlns="urn:xmpp:file:metadata:0">
          <media-type>image/jpeg</media-type>
          <name>pic.jpg</name>
          <size>12345</size>
        </file>
      </message>`)
    )
    expect(m?.attachments).toEqual([
      {
        url: 'https://files.example.net/pic.jpg',
        mediaType: 'image/jpeg',
        name: 'pic.jpg',
        size: 12345
      }
    ])
  })

  it('uses the OOB url as the body when no body is present', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <x xmlns="jabber:x:oob"><url>https://files.example.net/doc.pdf</url></x>
      </message>`)
    )
    expect(m?.body).toBe('https://files.example.net/doc.pdf')
    expect(m?.attachments?.[0]?.url).toBe('https://files.example.net/doc.pdf')
  })

  it('returns null for empty stanzas', () => {
    const m = parseMessage(xml(`<message from="a@b.c" to="x@y.z" type="chat"/>`))
    expect(m).toBeNull()
  })
})

describe('parsePresence', () => {
  it('parses plain presence', () => {
    const p = parsePresence(
      xml(`<presence from="a@b.c/res"><show>away</show><status>lunch</status></presence>`)
    )
    expect(p).toEqual({
      kind: 'presence',
      presence: { from: 'a@b.c', show: 'away', status: 'lunch', type: undefined }
    })
  })

  it('parses unavailable as offline', () => {
    const p = parsePresence(xml(`<presence from="a@b.c/res" type="unavailable"/>`))
    expect(p?.kind).toBe('presence')
    if (p?.kind === 'presence') expect(p.presence.show).toBe('offline')
  })

  it('parses a subscription request', () => {
    const p = parsePresence(
      xml(`<presence from="new@b.c" type="subscribe"><status>hi</status></presence>`)
    )
    expect(p).toEqual({ kind: 'subscribe', from: 'new@b.c', status: 'hi' })
  })

  it('parses MUC occupant presence with self flag', () => {
    const p = parsePresence(
      xml(`<presence from="room@conference.x.y/mynick">
        <x xmlns="http://jabber.org/protocol/muc#user">
          <item affiliation="member" role="participant"/>
          <status code="110"/>
        </x>
      </presence>`)
    )
    expect(p?.kind).toBe('occupant')
    if (p?.kind === 'occupant') {
      expect(p.occupant.nick).toBe('mynick')
      expect(p.occupant.self).toBe(true)
      expect(p.occupant.role).toBe('participant')
    }
  })
})

describe('parseRosterItems', () => {
  it('parses items with groups', () => {
    const items = parseRosterItems(
      xml(`<iq type="result"><query xmlns="jabber:iq:roster">
        <item jid="a@b.c" name="A" subscription="both"><group>Friends</group></item>
        <item jid="x@y.z" subscription="remove"/>
      </query></iq>`)
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ jid: 'a@b.c', name: 'A', subscription: 'both' })
    expect(items[0]?.groups).toEqual(['Friends'])
    expect(items[1]?.subscription).toBe('remove')
  })
})
