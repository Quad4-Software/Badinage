import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { parseMessage } from '..'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  // xmldom's Element type is structural enough for the parser functions
  return doc as unknown as Element
}
describe('parseMessage extensions', () => {
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

describe('new message extensions', () => {
  it('parses an attention request', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <attention xmlns="urn:xmpp:attention:0"/>
      </message>`)
    )
    expect(m?.attention).toBe(true)
  })

  it('parses rtt events and ops', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <rtt xmlns="urn:xmpp:rtt:0" seq="7" event="edit">
          <t p="3">x</t><e n="2"/><w n="300"/><d p="1"/>
        </rtt>
      </message>`)
    )
    expect(m?.rtt).toMatchObject({ seq: 7, event: 'edit' })
    expect(m?.rtt?.ops).toEqual([
      { type: 't', p: 3, text: 'x' },
      { type: 'e', p: undefined, n: 2 },
      { type: 'w', n: 300 },
      { type: 'd', p: 1, n: undefined }
    ])
  })

  it('parses references with positions and uris', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="groupchat">
        <body>ping @nick check xmpp:file</body>
        <reference xmlns="urn:xmpp:reference:0" type="mention" begin="5" end="10" uri="xmpp:room@b.c/nick"/>
        <reference xmlns="urn:xmpp:reference:0" type="data" begin="16" end="26" uri="xmpp:file"/>
      </message>`)
    )
    expect(m?.references).toHaveLength(2)
    expect(m?.references?.[0]).toMatchObject({
      type: 'mention',
      begin: 5,
      end: 10,
      uri: 'xmpp:room@b.c/nick'
    })
  })

  it('parses an ephemeral timer', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>vanish</body>
        <ephemeral xmlns="urn:xmpp:ephemeral:0" timer="60"/>
      </message>`)
    )
    expect(m?.ephemeralTimer).toBe(60)
  })

  it('parses a geoloc element', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <geoloc xmlns="http://jabber.org/protocol/geoloc">
          <lat>51.5</lat><lon>-0.12</lon><accuracy>20</accuracy>
        </geoloc>
      </message>`)
    )
    expect(m?.geoloc).toMatchObject({ lat: 51.5, lon: -0.12, accuracy: 20 })
  })
})
