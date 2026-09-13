import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import {
  hasDiscoFeature,
  parseAvatarHash,
  parseBlockPush,
  parseBookmark,
  parseBookmarkItems,
  parseCaps,
  parseDataForm,
  parseDiscoInfo,
  parseDiscoItems,
  parseJidItems,
  parseMamFin,
  parseMessage,
  parsePepEvent,
  parsePresence,
  parseRoomDecline,
  parseRoomInvite,
  parseRosterItems,
  parseUploadSlot,
  parseVcardPhoto
} from './stanzas'

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

  it('keeps omemo stanzas and exposes the encrypted element as xml', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>I sent you an OMEMO encrypted message but your client does not support it.</body>
        <encrypted xmlns="urn:xmpp:omemo:2">
          <header sid="123"><keys jid="a@b.c"><key rid="9" kex="true">AAAA</key></keys></header>
          <payload>BBBB</payload>
        </encrypted>
      </message>`)
    )
    expect(m).not.toBeNull()
    expect(m?.encryptedXml).toContain('<encrypted')
    expect(m?.encryptedXml).toContain('sid="123"')
  })

  it('parses a direct message retraction', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat" id="retract-1">
        <retract xmlns="urn:xmpp:message-retract:1" id="m1"/>
        <fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:message-retract:1"/>
        <body>/me retracted a message</body>
        <store xmlns="urn:xmpp:hints"/>
      </message>`)
    )
    expect(m?.retractId).toBe('m1')
    // the fallback body is parsed but must never render; ingest swallows it
    expect(m?.body).toBe('/me retracted a message')
  })

  it('marks a retraction stanza even when the retract element lacks an id', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <retract xmlns="urn:xmpp:message-retract:1"/>
        <body>secret fallback</body>
      </message>`)
    )
    expect(m?.retractId).toBe('')
  })

  it('parses a legacy fasten-wrapped retraction', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <apply-to xmlns="urn:xmpp:fasten:0" id="m2">
          <retract xmlns="urn:xmpp:message-retract:0"/>
        </apply-to>
      </message>`)
    )
    expect(m?.retractId).toBe('m2')
  })

  it('marks an archive tombstone on the stanza itself', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat" id="m1">
        <retracted xmlns="urn:xmpp:message-retract:1" id="retract-9" stamp="2024-03-01T10:00:00Z"/>
      </message>`)
    )
    expect(m?.retracted).toEqual({ reason: undefined, by: undefined })
    expect(m?.retractId).toBeUndefined()
  })

  it('parses a spoiler with and without a hint', () => {
    const hinted = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>the butler did it</body>
        <spoiler xmlns="urn:xmpp:spoiler:0">book ending</spoiler>
      </message>`)
    )
    expect(hinted?.spoilerHint).toBe('book ending')

    const hintless = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>the butler did it</body>
        <spoiler xmlns="urn:xmpp:spoiler:0"/>
      </message>`)
    )
    expect(hintless?.spoilerHint).toBe('')
  })

  it('parses the unstyled opt-out', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>*not bold*</body>
        <unstyled xmlns="urn:xmpp:styling:0"/>
      </message>`)
    )
    expect(m?.unstyled).toBe(true)
  })

  it('captures legacy-namespace encrypted elements the same way', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>I sent you an OMEMO encrypted message but your client does not support it.</body>
        <encrypted xmlns="eu.siacs.conversations.axolotl">
          <header sid="7"><key rid="9">AAAA</key></header>
          <payload>BBBB</payload>
        </encrypted>
      </message>`)
    )
    expect(m).not.toBeNull()
    expect(m?.encryptedXml).toContain('eu.siacs.conversations.axolotl')
  })

  it('returns null for empty stanzas', () => {
    const m = parseMessage(xml(`<message from="a@b.c" to="x@y.z" type="chat"/>`))
    expect(m).toBeNull()
  })

  it('parses a XEP-0421 occupant id on groupchat messages', () => {
    const m = parseMessage(
      xml(`<message from="room@conference.x.y/nick1" to="x@y.z" type="groupchat">
        <body>hi</body>
        <occupant-id xmlns="urn:xmpp:occupant-id:0" id="occ-7"/>
      </message>`)
    )
    expect(m?.occupantId).toBe('occ-7')
  })

  it('parses a XEP-0425 moderation notice as a retraction', () => {
    const m = parseMessage(
      xml(`<message from="room@conference.x.y" to="x@y.z" type="groupchat">
        <retract xmlns="urn:xmpp:message-retract:1" id="stanza-9">
          <moderated xmlns="urn:xmpp:message-moderate:1" by="mod@x.y">
            <occupant-id xmlns="urn:xmpp:occupant-id:0" id="occ-mod"/>
          </moderated>
          <reason>spam</reason>
        </retract>
      </message>`)
    )
    expect(m?.retraction).toEqual({ id: 'stanza-9', reason: 'spam', by: 'mod@x.y' })
    expect(m?.body).toBe('')
  })

  it('reads the moderating occupant id when no by jid is present', () => {
    const m = parseMessage(
      xml(`<message from="room@conference.x.y" to="x@y.z" type="groupchat">
        <retract xmlns="urn:xmpp:message-retract:1" id="stanza-9">
          <moderated xmlns="urn:xmpp:message-moderate:1">
            <occupant-id xmlns="urn:xmpp:occupant-id:0" id="occ-mod"/>
          </moderated>
        </retract>
      </message>`)
    )
    expect(m?.retraction?.by).toBe('occ-mod')
  })

  it('parses a retracted tombstone on archived messages', () => {
    const m = parseMessage(
      xml(`<message from="room@conference.x.y/nick1" to="x@y.z" type="groupchat">
        <body>gone</body>
        <retracted xmlns="urn:xmpp:message-retract:1" stamp="2024-03-03T10:00:00Z">
          <moderated xmlns="urn:xmpp:message-moderate:1" by="mod@x.y"/>
        </retracted>
      </message>`)
    )
    expect(m?.retracted).toEqual({ reason: undefined, by: 'mod@x.y' })
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

  it('parses occupant jid, occupant-id and status codes', () => {
    const p = parsePresence(
      xml(`<presence from="room@conference.x.y/nick1">
        <x xmlns="http://jabber.org/protocol/muc#user">
          <item affiliation="member" role="participant" jid="real@x.y/phone"/>
          <status code="110"/>
        </x>
        <occupant-id xmlns="urn:xmpp:occupant-id:0" id="occ-1"/>
      </presence>`)
    )
    if (p?.kind !== 'occupant') throw new Error('expected occupant')
    expect(p.occupant.jid).toBe('real@x.y/phone')
    expect(p.occupant.occupantId).toBe('occ-1')
    expect(p.occupant.codes).toEqual(['110'])
  })

  it('parses a 303 nick change broadcast', () => {
    const p = parsePresence(
      xml(`<presence from="room@conference.x.y/old" type="unavailable">
        <x xmlns="http://jabber.org/protocol/muc#user">
          <item affiliation="member" role="none" nick="new"/>
          <status code="303"/>
          <status code="110"/>
        </x>
      </presence>`)
    )
    if (p?.kind !== 'occupant') throw new Error('expected occupant')
    expect(p.occupant.presence).toBe('offline')
    expect(p.occupant.newNick).toBe('new')
    expect(p.occupant.self).toBe(true)
  })

  it('parses a kick with the item reason', () => {
    const p = parsePresence(
      xml(`<presence from="room@conference.x.y/nick1" type="unavailable">
        <x xmlns="http://jabber.org/protocol/muc#user">
          <item affiliation="member" role="none">
            <reason>flooding</reason>
          </item>
          <status code="307"/>
        </x>
      </presence>`)
    )
    if (p?.kind !== 'occupant') throw new Error('expected occupant')
    expect(p.occupant.reason).toBe('flooding')
    expect(p.occupant.codes).toContain('307')
  })

  it('handles muc presence without an item element', () => {
    const p = parsePresence(
      xml(`<presence from="room@conference.x.y/nick1">
        <x xmlns="http://jabber.org/protocol/muc#user"/>
      </presence>`)
    )
    if (p?.kind !== 'occupant') throw new Error('expected occupant')
    expect(p.occupant.affiliation).toBe('none')
    expect(p.occupant.role).toBe('none')
  })

  it('parses a presence stanza error', () => {
    const p = parsePresence(
      xml(`<presence from="room@conference.x.y/nick1" to="x@y.z" type="error">
        <error type="cancel" code="409">
          <conflict xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/>
          <text xmlns="urn:ietf:params:xml:ns:xmpp-stanzas">nick in use</text>
        </error>
      </presence>`)
    )
    expect(p).toEqual({
      kind: 'presenceError',
      error: {
        from: 'room@conference.x.y/nick1',
        code: '409',
        condition: 'conflict',
        text: 'nick in use'
      }
    })
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

describe('parseJidItems', () => {
  it('collects jids from a block push', () => {
    const block = xml(`<block xmlns="urn:xmpp:blocking">
      <item jid="spam@a.b"/>
      <item jid="junk@c.d/phone"/>
    </block>`)
    expect(parseJidItems(block)).toEqual(['spam@a.b', 'junk@c.d/phone'])
  })

  it('collects jids from a blocklist result', () => {
    const list = xml(`<blocklist xmlns="urn:xmpp:blocking"><item jid="a@b.c"/></blocklist>`)
    expect(parseJidItems(list)).toEqual(['a@b.c'])
  })

  it('returns an empty list for an item-less unblock', () => {
    expect(parseJidItems(xml(`<unblock xmlns="urn:xmpp:blocking"/>`))).toEqual([])
  })
})

describe('parseBlockPush', () => {
  it('separates blocked and unblocked jids in one push', () => {
    const push = parseBlockPush(
      xml(`<iq type="set"><block xmlns="urn:xmpp:blocking"><item jid="spam@a.b"/></block>
        <unblock xmlns="urn:xmpp:blocking"><item jid="ok@c.d"/></unblock></iq>`)
    )
    expect(push.blocked).toEqual(['spam@a.b'])
    expect(push.unblocked).toEqual(['ok@c.d'])
  })

  it('leaves fields undefined when the push lacks the element', () => {
    const push = parseBlockPush(
      xml(`<iq type="set"><block xmlns="urn:xmpp:blocking"><item jid="spam@a.b"/></block></iq>`)
    )
    expect(push.blocked).toEqual(['spam@a.b'])
    expect(push.unblocked).toBeUndefined()
  })
})

describe('parseDiscoItems', () => {
  it('collects items with jid, node and name', () => {
    const items = parseDiscoItems(
      xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/disco#items">
        <item jid="upload.example.net" name="Uploads"/>
        <item jid="proxy.example.net" node="proxynode"/>
        <item/>
      </query></iq>`)
    )
    expect(items).toEqual([
      { jid: 'upload.example.net', name: 'Uploads', node: undefined },
      { jid: 'proxy.example.net', name: undefined, node: 'proxynode' }
    ])
  })
})

describe('parseDiscoInfo', () => {
  it('reads identities, features and extension forms', () => {
    const info = parseDiscoInfo(
      xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/disco#info">
        <identity category="client" type="pc" name="Exodus 0.9.1"/>
        <feature var="http://jabber.org/protocol/muc"/>
        <feature var="http://jabber.org/protocol/caps"/>
        <x xmlns="jabber:x:data" type="result">
          <field var="FORM_TYPE" type="hidden">
            <value>urn:xmpp:dataforms:softwareinfo</value>
          </field>
          <field var="software"><value>Exodus</value></field>
          <field var="ip_version"><value>ipv4</value><value>ipv6</value></field>
        </x>
      </query></iq>`)
    )
    expect(info.identities).toEqual([
      { category: 'client', type: 'pc', name: 'Exodus 0.9.1', lang: undefined }
    ])
    expect(info.features).toContain('http://jabber.org/protocol/muc')
    expect(info.forms).toEqual([
      {
        formType: 'urn:xmpp:dataforms:softwareinfo',
        fields: [
          { var: 'software', values: ['Exodus'] },
          { var: 'ip_version', values: ['ipv4', 'ipv6'] }
        ]
      }
    ])
  })

  it('skips submit-type forms and tolerates empty results', () => {
    const info = parseDiscoInfo(
      xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/disco#info">
        <x xmlns="jabber:x:data" type="submit"><field var="FORM_TYPE"><value>x</value></field></x>
      </query></iq>`)
    )
    expect(info).toEqual({ identities: [], features: [], forms: [] })
  })
})

describe('parseCaps', () => {
  it('reads the entity capabilities element', () => {
    const caps = parseCaps(
      xml(`<presence from="a@b.c/r">
        <c xmlns="http://jabber.org/protocol/caps" hash="sha-1" node="https://x.c/caps" ver="abc="/>
      </presence>`)
    )
    expect(caps).toEqual({ node: 'https://x.c/caps', hash: 'sha-1', ver: 'abc=' })
  })

  it('returns null when attributes are missing', () => {
    expect(
      parseCaps(
        xml(`<presence><c xmlns="http://jabber.org/protocol/caps" hash="sha-1"/></presence>`)
      )
    ).toBeNull()
    expect(parseCaps(xml(`<presence/>`))).toBeNull()
  })
})

describe('parseAvatarHash', () => {
  it('reads the vcard-temp:x:update photo hash', () => {
    const stanza = xml(`<presence from="a@b.c/r">
      <x xmlns="vcard-temp:x:update"><photo>  aabbcc  </photo></x>
    </presence>`)
    expect(parseAvatarHash(stanza)).toBe('aabbcc')
  })

  it('returns an empty string for an explicit no-avatar update', () => {
    const stanza = xml(`<presence from="a@b.c/r">
      <x xmlns="vcard-temp:x:update"><photo/></x>
    </presence>`)
    expect(parseAvatarHash(stanza)).toBe('')
  })

  it('returns undefined when no update element is present', () => {
    expect(parseAvatarHash(xml(`<presence from="a@b.c/r"/>`))).toBeUndefined()
  })
})

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

describe('hasDiscoFeature', () => {
  it('finds the advertised feature var', () => {
    const stanza = xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/disco#info">
      <feature var="urn:xmpp:http:upload:0"/>
    </query></iq>`)
    expect(hasDiscoFeature(stanza, 'urn:xmpp:http:upload:0')).toBe(true)
    expect(hasDiscoFeature(stanza, 'jabber:iq:roster')).toBe(false)
  })
})

describe('parseUploadSlot', () => {
  it('reads urls from attributes', () => {
    const slot = parseUploadSlot(
      xml(`<iq type="result"><slot xmlns="urn:xmpp:http:upload:0">
        <put url="https://up.example.net/put"/><get url="https://up.example.net/get"/>
      </slot></iq>`)
    )
    expect(slot).toEqual({
      putUrl: 'https://up.example.net/put',
      getUrl: 'https://up.example.net/get'
    })
  })

  it('reads urls from text content', () => {
    const slot = parseUploadSlot(
      xml(`<iq type="result"><slot xmlns="urn:xmpp:http:upload:0">
        <put>https://up.example.net/put</put><get>https://up.example.net/get</get>
      </slot></iq>`)
    )
    expect(slot).toEqual({
      putUrl: 'https://up.example.net/put',
      getUrl: 'https://up.example.net/get'
    })
  })

  it('returns null when a url is missing', () => {
    const slot = parseUploadSlot(
      xml(`<iq type="result"><slot xmlns="urn:xmpp:http:upload:0">
        <put url="https://up.example.net/put"/>
      </slot></iq>`)
    )
    expect(slot).toBeNull()
  })
})

describe('parseVcardPhoto', () => {
  it('builds a data uri from TYPE and BINVAL', () => {
    const uri = parseVcardPhoto(
      xml(`<iq type="result"><vCard xmlns="vcard-temp"><PHOTO>
        <TYPE>image/png</TYPE><BINVAL>aGk=</BINVAL>
      </PHOTO></vCard></iq>`)
    )
    expect(uri).toBe('data:image/png;base64,aGk=')
  })

  it('returns undefined without a photo', () => {
    const stanza = xml(`<iq type="result"><vCard xmlns="vcard-temp"/></iq>`)
    expect(parseVcardPhoto(stanza)).toBeUndefined()
  })
})

describe('parseMamFin', () => {
  it('extracts the rsm cursor', () => {
    const fin = parseMamFin(
      xml(`<iq type="result"><fin xmlns="urn:xmpp:mam:2" complete="false">
        <set xmlns="http://jabber.org/protocol/rsm">
          <first>uid-1</first><last>uid-9</last><count>9</count>
        </set>
      </fin></iq>`)
    )
    expect(fin).toEqual({ complete: false, first: 'uid-1', last: 'uid-9' })
  })

  it('reports a complete archive without a cursor', () => {
    const fin = parseMamFin(
      xml(`<iq type="result"><fin xmlns="urn:xmpp:mam:2" complete="true"/></iq>`)
    )
    expect(fin.complete).toBe(true)
    expect(fin.first).toBeUndefined()
    expect(fin.last).toBeUndefined()
  })
})

describe('parseRoomInvite', () => {
  it('parses a direct XEP-0249 invite with password, reason and continue', () => {
    const invite = parseRoomInvite(
      xml(`<message from="crone@shakespeare.lit" to="me@x.y">
        <x xmlns="jabber:x:conference" jid="darkcave@macbeth.shakespeare.lit"
           password="cauldronburn" reason="come chat" continue="true"/>
      </message>`)
    )
    expect(invite).toEqual({
      room: 'darkcave@macbeth.shakespeare.lit',
      from: 'crone@shakespeare.lit',
      kind: 'direct',
      password: 'cauldronburn',
      reason: 'come chat',
      continueSession: true
    })
  })

  it('parses a mediated muc#user invite with reason and password', () => {
    const invite = parseRoomInvite(
      xml(`<message from="darkcave@chat.shakespeare.lit" to="me@x.y">
        <x xmlns="http://jabber.org/protocol/muc#user">
          <invite from="crone@shakespeare.lit"><reason>blood</reason></invite>
          <password>cauldronburn</password>
        </x>
      </message>`)
    )
    expect(invite).toEqual({
      room: 'darkcave@chat.shakespeare.lit',
      from: 'crone@shakespeare.lit',
      kind: 'mediated',
      password: 'cauldronburn',
      reason: 'blood'
    })
  })

  it('returns null for messages without an invite', () => {
    expect(
      parseRoomInvite(xml(`<message from="a@b.c" to="x@y.z"><body>hi</body></message>`))
    ).toBeNull()
  })
})

describe('parseRoomDecline', () => {
  it('parses a mediated decline relayed by the room', () => {
    const decline = parseRoomDecline(
      xml(`<message from="darkcave@chat.shakespeare.lit" to="me@x.y">
        <x xmlns="http://jabber.org/protocol/muc#user">
          <decline from="hag66@shakespeare.lit"><reason>busy</reason></decline>
        </x>
      </message>`)
    )
    expect(decline).toEqual({
      room: 'darkcave@chat.shakespeare.lit',
      from: 'hag66@shakespeare.lit',
      reason: 'busy'
    })
  })
})

describe('parseDataForm', () => {
  it('parses a room config form generically', () => {
    const form = parseDataForm(
      xml(`<iq type="result" to="me@x.y" from="room@conference.x.y">
        <query xmlns="http://jabber.org/protocol/muc#owner">
          <x xmlns="jabber:x:data" type="form">
            <title>Config</title>
            <instructions>Fill it in</instructions>
            <field var="FORM_TYPE" type="hidden"><value>http://jabber.org/protocol/muc#roomconfig</value></field>
            <field var="muc#roomconfig_persistentroom" type="boolean" label="Persistent">
              <value>1</value>
            </field>
            <field var="muc#roomconfig_whois" type="list-single" label="Whois">
              <option label="Mods"><value>moderators</value></option>
              <option label="All"><value>anyone</value></option>
              <value>moderators</value>
            </field>
            <field var="muc#roomconfig_roomadmins" type="jid-multi">
              <desc>Admin list</desc>
              <required/>
              <value>a@x.y</value><value>b@x.y</value>
            </field>
          </x>
        </query>
      </iq>`)
    )
    expect(form?.title).toBe('Config')
    expect(form?.instructions).toBe('Fill it in')
    expect(form?.fields).toHaveLength(4)
    expect(form?.fields[1]).toMatchObject({ type: 'boolean', values: ['1'] })
    expect(form?.fields[2]?.options).toEqual([
      { value: 'moderators', label: 'Mods' },
      { value: 'anyone', label: 'All' }
    ])
    expect(form?.fields[3]?.required).toBe(true)
    expect(form?.fields[3]?.values).toEqual(['a@x.y', 'b@x.y'])
    expect(form?.fields[3]?.desc).toBe('Admin list')
  })

  it('returns null when no data form is present', () => {
    expect(
      parseDataForm(
        xml(`<iq type="result"><query xmlns="http://jabber.org/protocol/muc#owner"/></iq>`)
      )
    ).toBeNull()
  })
})
