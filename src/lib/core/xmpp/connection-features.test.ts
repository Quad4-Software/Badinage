import { Strophe } from 'strophe.js'
import { describe, expect, it, vi } from 'vitest'

import { findHandler, makeStub, xml } from '../../../../test/stub-connection'

describe('XmppConnection stanza senders and pep trust', () => {
  describe('outgoing message stanzas', () => {
    it('emits a retract element with fallback and store hint', () => {
      const stub = makeStub()
      stub.xmpp.connect('me@example.net/res', 'secret')
      stub.drive(Strophe.Status.CONNECTED)
      stub.send.mockClear()

      stub.xmpp.sendRetraction('peer@example.net', 'orig-1')
      const sent = stub.send.mock.calls.map((c) => String(c[0]))
      expect(sent).toHaveLength(1)
      expect(sent[0]).toContain('<retract')
      expect(sent[0]).toContain('urn:xmpp:message-retract:1')
      expect(sent[0]).toContain('id="orig-1"')
      expect(sent[0]).toContain('<fallback')
      expect(sent[0]).toContain('urn:xmpp:fallback:0')
      expect(sent[0]).toContain('<store')
      expect(sent[0]).toContain('urn:xmpp:hints')
    })

    it('emits a spoiler element with and without a hint', () => {
      const stub = makeStub()
      stub.xmpp.connect('me@example.net/res', 'secret')
      stub.drive(Strophe.Status.CONNECTED)
      stub.send.mockClear()

      stub.xmpp.sendChatMessage('peer@example.net', 'secret text', 'chat', {
        spoilerHint: 'ending'
      })
      stub.xmpp.sendChatMessage('peer@example.net', 'hintless text', 'chat', { spoilerHint: '' })
      const sent = stub.send.mock.calls.map((c) => String(c[0]))
      expect(sent).toHaveLength(2)
      expect(sent[0]).toContain('<spoiler xmlns="urn:xmpp:spoiler:0">ending</spoiler>')
      expect(sent[1]).toContain('<spoiler xmlns="urn:xmpp:spoiler:0"/>')
    })

    it('emits attention, rtt, references, ephemeral and geoloc elements', () => {
      const stub = makeStub()
      stub.xmpp.connect('me@example.net/res', 'secret')
      stub.drive(Strophe.Status.CONNECTED)
      stub.send.mockClear()

      stub.xmpp.sendAttention('peer@example.net', 'chat')
      stub.xmpp.sendRtt('peer@example.net', 1, 'new', [{ type: 't', text: 'hi' }])
      stub.xmpp.sendChatMessage('peer@example.net', 'hey @nick', 'groupchat', {
        references: [{ type: 'mention', begin: 4, end: 9, uri: 'xmpp:peer@example.net/nick' }],
        ephemeral: 300,
        geoloc: { lat: 1.5, lon: 2.5 }
      })
      const sent = stub.send.mock.calls.map((c) => String(c[0]))
      expect(sent).toHaveLength(3)
      expect(sent[0]).toContain('<attention xmlns="urn:xmpp:attention:0"/>')
      expect(sent[1]).toContain('<rtt')
      expect(sent[1]).toContain('xmlns="urn:xmpp:rtt:0"')
      expect(sent[1]).toContain('event="new"')
      expect(sent[1]).toContain('seq="1"')
      expect(sent[2]).toContain('<reference')
      expect(sent[2]).toContain('xmlns="urn:xmpp:reference:0"')
      expect(sent[2]).toContain('type="mention"')
      expect(sent[2]).toContain('<ephemeral timer="300" xmlns="urn:xmpp:ephemeral:0"/>')
      expect(sent[2]).toContain('<geoloc xmlns="http://jabber.org/protocol/geoloc">')
      expect(sent[2]).toContain('<lat>1.5</lat>')
      expect(sent[2]).toContain('<lon>2.5</lon>')
    })
  })

  describe('pep event trust', () => {
    const mdsStanza = (
      from: string
    ) => `<message from='${from}' to='me@example.net/res' type='headline'>
      <event xmlns='http://jabber.org/protocol/pubsub#event'>
        <items node='urn:xmpp:mds:displayed:0'>
          <item id='peer@example.net'>
            <displayed xmlns='urn:xmpp:mds:displayed:0'>
              <stanza-id xmlns='urn:xmpp:sid:0' id='srv-1'/>
            </displayed>
          </item>
        </items>
      </event>
    </message>`

    it('drops mds events not sent by our own account', () => {
      const stub = makeStub()
      const onMds = vi.fn()
      stub.xmpp.events.on('mds', onMds)
      stub.xmpp.connect('me@example.net/res', 'secret')
      stub.drive(Strophe.Status.CONNECTED)
      const handler = findHandler(stub, 'message')

      // a forged event from a stranger must never reach the app
      handler(xml(mdsStanza('evil@other.net')))
      expect(onMds).not.toHaveBeenCalled()

      // our own bare jid is the publisher of our private MDS node
      handler(xml(mdsStanza('me@example.net')))
      expect(onMds).toHaveBeenCalledTimes(1)
      expect(onMds.mock.calls[0]?.[0]).toEqual([
        { peer: 'peer@example.net', stanzaId: 'srv-1', by: undefined }
      ])
    })

    it('drops bookmark pushes from foreign jids', () => {
      const stub = makeStub()
      const onBookmarks = vi.fn()
      stub.xmpp.events.on('bookmarks', onBookmarks)
      stub.xmpp.connect('me@example.net/res', 'secret')
      stub.drive(Strophe.Status.CONNECTED)
      const handler = findHandler(stub, 'message')

      handler(
        xml(`<message from='evil@other.net' type='headline'>
          <event xmlns='http://jabber.org/protocol/pubsub#event'>
            <items node='urn:xmpp:bookmarks:1'>
              <item id='room@conference.example.net'>
                <conference xmlns='urn:xmpp:bookmarks:1'/>
              </item>
            </items>
          </event>
        </message>`)
      )
      expect(onBookmarks).not.toHaveBeenCalled()
    })
  })
})
