// XEP-0077 in-band registration against the fake server: a successful
// register iq, a conflict for a taken username, and the unsupported path
// when the stream features do not advertise registration.

import { afterEach, describe, expect, it } from 'vitest'

import { FakeXmppServer } from '../../../../test/fake-xmpp-server'

import { RegisterError, registerAccount } from './register'

describe('registerAccount over a live fake xmpp server', () => {
  let server: FakeXmppServer | undefined

  afterEach(async () => {
    await server?.stop()
    server = undefined
  })

  it('resolves when the server accepts the registration', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({ registration: {} })
    await server.ready
    await registerAccount(server.url, 'newuser@example.net', 'secret')
    const iq = server.received().find((f) => f.includes('jabber:iq:register'))
    expect(iq).toContain('type="set"')
    expect(iq).toContain('<username>newuser</username>')
    expect(iq).toContain('<password>secret</password>')
  })

  it('rejects with conflict for a taken username', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({ registration: { taken: ['taken'] } })
    await server.ready
    await expect(registerAccount(server.url, 'taken@example.net', 'secret')).rejects.toMatchObject({
      name: 'RegisterError',
      reason: 'conflict'
    })
  })

  it(
    'rejects with unsupported when the feature is not advertised',
    {
      timeout: 10_000
    },
    async () => {
      server = new FakeXmppServer()
      await server.ready
      await expect(
        registerAccount(server.url, 'newuser@example.net', 'secret')
      ).rejects.toMatchObject({ reason: 'unsupported' })
    }
  )

  it('rejects with unsupported for a jid without a localpart', async () => {
    await expect(
      registerAccount('ws://127.0.0.1:1', 'example.net', 'secret')
    ).rejects.toBeInstanceOf(RegisterError)
    await expect(
      registerAccount('ws://127.0.0.1:1', 'example.net', 'secret')
    ).rejects.toMatchObject({ reason: 'unsupported' })
  })
})
