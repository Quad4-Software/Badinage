import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { parseAvatarHash, parseCaps, parsePresence } from '..'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  // xmldom's Element type is structural enough for the parser functions
  return doc as unknown as Element
}
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
