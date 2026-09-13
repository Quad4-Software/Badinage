import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { parseMdsItem, parseMessage } from '..'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  // xmldom's Element type is structural enough for the parser functions
  return doc as unknown as Element
}
describe('adversarial inputs', () => {
  it('rejects geoloc with out-of-range or non-numeric coordinates', () => {
    for (const [lat, lon] of [
      ['91', '0'],
      ['-91', '0'],
      ['0', '181'],
      ['0', '-181'],
      ['abc', '0'],
      ['', '']
    ]) {
      const m = parseMessage(
        xml(`<message from="a@b.c" to="x@y.z" type="chat">
          <geoloc xmlns="http://jabber.org/protocol/geoloc"><lat>${lat}</lat><lon>${lon}</lon></geoloc>
        </message>`)
      )
      expect(m?.geoloc).toBeUndefined()
    }
  })

  it('keeps a body when it also carries attention', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>wake up</body>
        <attention xmlns="urn:xmpp:attention:0"/>
      </message>`)
    )
    expect(m?.attention).toBe(true)
    expect(m?.body).toBe('wake up')
  })

  it('parses references verbatim even with absurd positions', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <body>hi</body>
        <reference xmlns="urn:xmpp:reference:0" type="mention" begin="-5" end="9999999"/>
      </message>`)
    )
    expect(m?.references?.[0]).toMatchObject({ type: 'mention', begin: -5, end: 9999999 })
  })

  it('ignores unknown rtt op elements', () => {
    const m = parseMessage(
      xml(`<message from="a@b.c" to="x@y.z" type="chat">
        <rtt xmlns="urn:xmpp:rtt:0" seq="1" event="edit"><bogus/><t>x</t></rtt>
      </message>`)
    )
    expect(m?.rtt?.ops).toEqual([{ type: 't', p: undefined, text: 'x' }])
  })

  it('drops non-finite or negative ephemeral timers', () => {
    for (const timer of ['-5', 'abc', '']) {
      const m = parseMessage(
        xml(`<message from="a@b.c" to="x@y.z" type="chat">
          <ephemeral xmlns="urn:xmpp:ephemeral:0" timer="${timer}"/>
        </message>`)
      )
      expect(m?.ephemeralTimer).toBeUndefined()
    }
  })

  it('mds item without stanza-id is not a marker', () => {
    const item = xml(`<item xmlns="http://jabber.org/protocol/pubsub" id="peer@b.c">
      <displayed xmlns="urn:xmpp:mds:displayed:0"/>
    </item>`)
    expect(parseMdsItem(item)).toBeNull()
  })

  // CVE-2017-5858 class: a forwarded payload wrapped in carbon markup
  // only unwraps when the outer stanza is addressed to and from the
  // same account. A failed wrapper poisons the whole stanza so the
  // nested body cannot leak through the descendant-search helpers.
  it('drops a carbon whose from and to differ', () => {
    const m = parseMessage(
      xml(`<message from="evil@example.net" to="me@example.net/home">
        <received xmlns="urn:xmpp:carbons:2">
          <forwarded xmlns="urn:xmpp:forward:0">
            <message from="boss@example.net" to="me@example.net" type="chat">
              <body>wire the money</body>
            </message>
          </forwarded>
        </received>
      </message>`)
    )
    expect(m).toBeNull()
  })

  it('drops a carbon with no from and to at all', () => {
    const m = parseMessage(
      xml(`<message>
        <sent xmlns="urn:xmpp:carbons:2">
          <forwarded xmlns="urn:xmpp:forward:0">
            <message from="me@example.net" to="peer@example.net" type="chat">
              <body>forged</body>
            </message>
          </forwarded>
        </sent>
      </message>`)
    )
    expect(m).toBeNull()
  })

  // a forged <result> can smuggle a fabricated archive row. Once the
  // pipeline passes context the wrapper only unwraps for an in-flight
  // queryid or our own bare jid.
  it('drops a MAM result with an unknown queryid from a stranger', () => {
    const stanza = xml(`<message from="evil@example.net" to="me@example.net/home">
      <result xmlns="urn:xmpp:mam:2" queryid="forged" id="a1">
        <forwarded xmlns="urn:xmpp:forward:0">
          <message from="alice@example.net" to="me@example.net" type="chat">
            <body>fake archive row</body>
          </message>
        </forwarded>
      </result>
    </message>`)
    const ctx = { ownBareJid: 'me@example.net', mamQueryIds: new Set(['real-q']) }
    expect(parseMessage(stanza, ctx)).toBeNull()
  })

  it('unwraps a MAM result whose queryid answers a live query', () => {
    const stanza = xml(`<message from="archive.example.net" to="me@example.net/home">
      <result xmlns="urn:xmpp:mam:2" queryid="real-q" id="a1">
        <forwarded xmlns="urn:xmpp:forward:0">
          <message from="alice@example.net" to="me@example.net" type="chat">
            <body>archived</body>
          </message>
        </forwarded>
      </result>
    </message>`)
    const ctx = { ownBareJid: 'me@example.net', mamQueryIds: new Set(['real-q']) }
    expect(parseMessage(stanza, ctx)?.mam).toBe(true)
    expect(parseMessage(stanza, ctx)?.body).toBe('archived')
  })

  it('unwraps a MAM result sent by our own account', () => {
    const stanza = xml(`<message from="me@example.net" to="me@example.net/home">
      <result xmlns="urn:xmpp:mam:2" queryid="any" id="a1">
        <forwarded xmlns="urn:xmpp:forward:0">
          <message from="alice@example.net" to="me@example.net" type="chat">
            <body>archived</body>
          </message>
        </forwarded>
      </result>
    </message>`)
    const ctx = { ownBareJid: 'me@example.net', mamQueryIds: new Set<string>() }
    expect(parseMessage(stanza, ctx)?.mam).toBe(true)
  })
})
