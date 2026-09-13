import { DOMParser } from '@xmldom/xmldom'
import { test } from 'vitest'

import { parseMessage, parsePresence, parseRosterItems } from '..'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad bench xml')
  return doc as unknown as Element
}

const chatMessage =
  xml(`<message from="romeo@example.net/phone" to="me@example.net/home" type="chat" id="m1">
  <body>hello there, how is the project coming along?</body>
  <stanza-id xmlns="urn:xmpp:sid:0" id="sid-1" by="example.net"/>
  <origin-id xmlns="urn:xmpp:sid:0" id="oid-1"/>
  <active xmlns="http://jabber.org/protocol/chatstates"/>
  <request xmlns="urn:xmpp:receipts"/>
</message>`)

const carbonMessage = xml(`<message from="me@example.net" to="me@example.net/home">
  <received xmlns="urn:xmpp:carbons:2">
    <forwarded xmlns="urn:xmpp:forward:0">
      <message from="peer@example.net/x" to="me@example.net" type="chat" id="c1">
        <body>a fairly typical carbon copied chat body</body>
        <delay xmlns="urn:xmpp:delay" stamp="2024-01-01T12:00:00Z"/>
      </message>
    </forwarded>
  </received>
</message>`)

const mamGroupchat =
  xml(`<message from="room@conference.example.net" to="me@example.net" type="groupchat" id="g1">
  <result xmlns="urn:xmpp:mam:2" queryid="q1" id="arch-1">
    <forwarded xmlns="urn:xmpp:forward:0">
      <delay xmlns="urn:xmpp:delay" stamp="2024-01-01T12:00:00Z"/>
      <message from="room@conference.example.net/alice" type="groupchat" id="g1">
        <body>a longer archived groupchat message body for benching</body>
        <stanza-id xmlns="urn:xmpp:sid:0" id="gsid-1" by="room@conference.example.net"/>
        <reactions xmlns="urn:xmpp:reactions:0" id="g0">
          <reaction>:+1:</reaction>
          <reaction>:tada:</reaction>
        </reactions>
      </message>
    </forwarded>
  </result>
</message>`)

const presence = xml(`<presence from="room@conference.example.net/alice" to="me@example.net/home">
  <x xmlns="http://jabber.org/protocol/muc#user">
    <item affiliation="member" role="participant"/>
    <status code="110"/>
  </x>
  <show>away</show>
  <status>be right back</status>
</presence>`)

const roster = xml(`<iq type="result" id="r1">
  <query xmlns="jabber:iq:roster" ver="v9">
    <item jid="a@example.net" name="Alice" subscription="both"><group>Friends</group></item>
    <item jid="b@example.net" name="Bob" subscription="both"><group>Friends</group><group>Work</group></item>
    <item jid="c@example.net" subscription="to"/>
    <item jid="d@example.net" subscription="from" ask="subscribe"/>
    <item jid="e@example.net" name="Eve" subscription="both"><group>Work</group></item>
  </query>
</iq>`)

test('parseMessage stanza variants', async ({ bench }) => {
  await bench.compare(
    bench('parseMessage plain chat', () => {
      parseMessage(chatMessage)
    }),
    bench('parseMessage carbon-wrapped', () => {
      parseMessage(carbonMessage)
    }),
    bench('parseMessage mam groupchat', () => {
      parseMessage(mamGroupchat)
    })
  )
})

test('presence and roster parsing', async ({ bench }) => {
  await bench.compare(
    bench('parsePresence muc', () => {
      parsePresence(presence)
    }),
    bench('parseRosterItems', () => {
      parseRosterItems(roster)
    })
  )
})
