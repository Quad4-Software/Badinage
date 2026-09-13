import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { parseRoomDecline, parseRoomInvite } from '..'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  // xmldom's Element type is structural enough for the parser functions
  return doc as unknown as Element
}
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
