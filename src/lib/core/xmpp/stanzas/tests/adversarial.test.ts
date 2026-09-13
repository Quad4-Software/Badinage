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
})
