import { afterEach, describe, expect, it } from 'vitest'

import { FakeXmppServer } from '../../../../../test/fake-xmpp-server'
import { xml } from '../../../../../test/stub-connection'
import { XmppConnection } from '../connection'

import { oauthAdvertised, parseOauthDiscovery, probeOauthSupport } from './oauth'

describe('parseOauthDiscovery', () => {
  it('reads the openid-configuration url out of the rfc 7628 error doc', () => {
    expect(
      parseOauthDiscovery(
        JSON.stringify({
          status: 'invalid_token',
          'openid-configuration': 'https://id.example.net/.well-known/openid-configuration'
        })
      )
    ).toBe('https://id.example.net/.well-known/openid-configuration')
  })

  it('rejects non-json, missing and non-https urls', () => {
    expect(parseOauthDiscovery('not json')).toBeUndefined()
    expect(parseOauthDiscovery('{}')).toBeUndefined()
    expect(parseOauthDiscovery(JSON.stringify({ 'openid-configuration': 42 }))).toBeUndefined()
    expect(
      parseOauthDiscovery(
        JSON.stringify({ 'openid-configuration': 'http://id.example.net/.well-known/oc' })
      )
    ).toBeUndefined()
    expect(parseOauthDiscovery(null)).toBeUndefined()
  })
})

describe('oauthAdvertised', () => {
  it('sees OAUTHBEARER in a stream features mechanisms block', () => {
    const features = xml(
      `<stream:features xmlns:stream='http://etherx.jabber.org/streams'>` +
        `<mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>` +
        `<mechanism>PLAIN</mechanism><mechanism>OAUTHBEARER</mechanism>` +
        `</mechanisms></stream:features>`
    )
    expect(oauthAdvertised(features)).toBe(true)
  })

  it('returns false without mechanisms or without the mechanism', () => {
    expect(oauthAdvertised(null)).toBe(false)
    expect(
      oauthAdvertised(
        xml(
          `<stream:features xmlns:stream='http://etherx.jabber.org/streams'>` +
            `<mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>` +
            `<mechanism>PLAIN</mechanism></mechanisms></stream:features>`
        )
      )
    ).toBe(false)
  })
})

describe('probeOauthSupport against a live fake server', () => {
  let server: FakeXmppServer | undefined

  afterEach(async () => {
    await server?.stop()
    server = undefined
  })

  it('harvests the discovery url from the empty-token challenge', async () => {
    server = new FakeXmppServer({
      oauth: { discoveryUrl: 'https://id.example.net/.well-known/openid-configuration' }
    })
    await server.ready

    const probe = await probeOauthSupport(server.url, 'me@example.net')
    expect(probe.supported).toBe(true)
    expect(probe.discoveryUrl).toBe('https://id.example.net/.well-known/openid-configuration')
  })

  it('reports unsupported when the server offers no OAUTHBEARER', async () => {
    server = new FakeXmppServer()
    await server.ready

    const probe = await probeOauthSupport(server.url, 'me@example.net')
    expect(probe.supported).toBe(false)
    expect(probe.discoveryUrl).toBeUndefined()
  })

  it('connects with a bearer token pinned to OAUTHBEARER', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({
      oauth: { discoveryUrl: 'https://id.example.net/.well-known/oc', token: 'tok1' }
    })
    await server.ready

    const xmpp = new XmppConnection(server.url, undefined, { oauth: true })
    const connected = new Promise<void>((resolve) => {
      const off = xmpp.events.on('status', (s) => {
        if (s === 'connected') {
          off()
          resolve()
        }
      })
    })
    xmpp.connect('oauth@example.net/res', 'tok1')
    await connected

    // the wire carries rfc 7628 client-first: gs2 header + auth=Bearer
    const auth = server.received().find((f) => f.startsWith('<auth'))
    expect(atob(/<auth[^>]*>([^<]*)<\/auth>/.exec(auth ?? '')?.[1] ?? '')).toContain(
      'auth=Bearer tok1'
    )
    xmpp.disconnect()
  })

  it('fails cleanly on a bad token', { timeout: 10_000 }, async () => {
    server = new FakeXmppServer({
      oauth: { discoveryUrl: 'https://id.example.net/.well-known/oc', token: 'tok1' }
    })
    await server.ready

    const xmpp = new XmppConnection(server.url, undefined, { oauth: true })
    const authfail = new Promise<void>((resolve) => {
      const off = xmpp.events.on('status', (s) => {
        if (s === 'authfail') {
          off()
          resolve()
        }
      })
    })
    xmpp.connect('oauth@example.net/res', 'wrong')
    await authfail
    xmpp.disconnect()
  })
})
