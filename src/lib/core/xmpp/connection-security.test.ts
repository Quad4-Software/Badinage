// Forgery-resistance tests for the stanza pipeline: sender checks on
// roster and blocklist pushes (RFC 6121 2.1.6, XEP-0191) and the
// queryid authentication for MAM result wrappers (CVE-2017-5858 class).

import { Strophe } from 'strophe.js'
import { describe, expect, it, vi } from 'vitest'

import { findHandler, makeStub, xml } from '../../../../test/stub-connection'

describe('XmppConnection stanza forgery resistance', () => {
  it('refuses a roster push from a foreign sender', () => {
    const stub = makeStub()
    const onUpdate = vi.fn()
    stub.xmpp.events.on('rosterUpdate', onUpdate)
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'iq', 'jabber:iq:roster')
    stub.send.mockClear()
    handler(
      xml(`<iq type='set' id='rp-evil' from='evil@example.net'>
        <query xmlns='jabber:iq:roster'>
          <item jid='peer@example.net' name='Peer' subscription='both'/>
        </query>
      </iq>`)
    )

    expect(onUpdate).not.toHaveBeenCalled()
    const replies = stub.send.mock.calls.map((c) => String(c[0]))
    expect(replies).toHaveLength(1)
    expect(replies[0]).toContain('type="error"')
    expect(replies[0]).toContain('id="rp-evil"')
    expect(replies[0]).toContain('service-unavailable')
  })

  it('refuses a blocklist push from a foreign sender', () => {
    const stub = makeStub()
    const onBlocked = vi.fn()
    stub.xmpp.events.on('blocked', onBlocked)
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'iq', 'urn:xmpp:blocking')
    stub.send.mockClear()
    handler(
      xml(`<iq type='set' id='b-evil' from='evil@example.net'>
        <block xmlns='urn:xmpp:blocking'><item jid='spam@example.net'/></block>
      </iq>`)
    )

    expect(onBlocked).not.toHaveBeenCalled()
    const replies = stub.send.mock.calls.map((c) => String(c[0]))
    expect(replies).toHaveLength(1)
    expect(replies[0]).toContain('type="error"')
    expect(replies[0]).toContain('service-unavailable')
  })

  // A MAM <result> only unwraps while its queryid names an in-flight
  // query (or the sender is our own account); a forged result carries a
  // poisoned wrapper and the whole stanza is dropped.
  it('only unwraps archive results that answer an in-flight query', () => {
    const stub = makeStub()
    const onMessage = vi.fn()
    stub.xmpp.events.on('message', onMessage)
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'message')
    const result = (queryid: string, from: string) =>
      xml(`<message from='${from}' to='me@example.net/res'>
        <result xmlns='urn:xmpp:mam:2' queryid='${queryid}' id='a1'>
          <forwarded xmlns='urn:xmpp:forward:0'>
            <message from='peer@example.net' to='me@example.net' type='chat'>
              <body>archived</body>
            </message>
          </forwarded>
        </result>
      </message>`)

    // no query in flight yet: a stranger's result is dropped entirely
    handler(result('mam-1', 'evil@example.net'))
    expect(onMessage).not.toHaveBeenCalled()

    // the stub mints 'mam-1' as the queryid; while the query is live the
    // echo unwraps even when the sending entity is an archive component
    stub.xmpp.queryArchive('peer@example.net', {}, vi.fn())
    handler(result('mam-1', 'archive.example.net'))
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ mam: true }))

    onMessage.mockClear()
    // our own account's results stay trusted for servers that omit the
    // queryid echo on personal archives
    handler(result('other-q', 'me@example.net'))
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ mam: true }))
  })

  it('stops trusting queryids once the stream dies', () => {
    const stub = makeStub()
    const onMessage = vi.fn()
    stub.xmpp.events.on('message', onMessage)
    stub.xmpp.connect('me@example.net/res', 'secret')
    stub.drive(Strophe.Status.CONNECTED)

    stub.xmpp.queryArchive('peer@example.net', {}, vi.fn())
    // manual disconnect so no reconnect timer fires under real timers
    stub.xmpp.disconnect()
    stub.drive(Strophe.Status.DISCONNECTED)
    stub.drive(Strophe.Status.CONNECTED)

    const handler = findHandler(stub, 'message')
    handler(
      xml(`<message from='evil@example.net' to='me@example.net/res'>
        <result xmlns='urn:xmpp:mam:2' queryid='mam-1' id='a1'>
          <forwarded xmlns='urn:xmpp:forward:0'>
            <message from='peer@example.net' to='me@example.net' type='chat'>
              <body>stale</body>
            </message>
          </forwarded>
        </result>
      </message>`)
    )
    expect(onMessage).not.toHaveBeenCalled()
  })
})
