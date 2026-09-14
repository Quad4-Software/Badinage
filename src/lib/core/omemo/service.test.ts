// OmemoService behaviors over an in-memory PEP directory: two accounts
// publish to and fetch from one shared map, so encrypt/decrypt round
// trips exercise the real wire path without a server.

import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import type { ChatConnection } from '$lib/core/xmpp/connection'
import type { IncomingMessage, TrustOwner } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

import { InMemoryOmemoStore, NAMESPACES } from '@quad4-software/badinage-omemo'

import { MemoryKeyMetaStore } from './rotation'
import { OmemoService } from './service'
import { InMemoryTrustStore } from './trust'

const parser = new DOMParser()

// bare jid -> pubsub node -> latest published payload xml
type PepDir = Map<string, Map<string, string>>

class FakeConnection {
  readonly notifications: { to: string; xml: string }[] = []
  readonly sentEncrypted: { to: string; xml: string }[] = []
  readonly trustMessages: { to: string; usage: string; owners: TrustOwner[] }[] = []
  private counter = 0

  constructor(
    readonly jid: string,
    private readonly pep: PepDir
  ) {}

  uniqueId(prefix: string): string {
    this.counter += 1
    return `${prefix}-${this.counter}`
  }

  pepGet(node: string, jid: string | undefined, onDone: (items: Element | null) => void): void {
    const owner = bareJid(jid ?? this.jid)
    const payload = this.pep.get(owner)?.get(node)
    if (!payload) {
      onDone(null)
      return
    }
    const doc = parser.parseFromString(
      `<items node="${node}"><item id="current">${payload}</item></items>`,
      'application/xml'
    )
    onDone(doc.documentElement as unknown as Element)
  }

  pepPublish(node: string, itemId: string, payloadXml: string): void {
    void itemId
    const owner = bareJid(this.jid)
    let nodes = this.pep.get(owner)
    if (!nodes) {
      nodes = new Map()
      this.pep.set(owner, nodes)
    }
    nodes.set(node, payloadXml)
  }

  sendEncryptedMessage(to: string, encryptedXml: string): string {
    this.sentEncrypted.push({ to, xml: encryptedXml })
    return this.uniqueId('msg')
  }

  sendEncryptedNotification(to: string, encryptedXml: string): void {
    this.notifications.push({ to, xml: encryptedXml })
  }

  sendTrustMessage(to: string, usage: string, owners: TrustOwner[]): void {
    this.trustMessages.push({ to, usage, owners })
  }
}

interface Fixture {
  service: OmemoService
  connection: FakeConnection
}

async function makeAccount(jid: string, pep: PepDir): Promise<Fixture> {
  const connection = new FakeConnection(jid, pep)
  const service = await OmemoService.create({
    connection: connection as unknown as ChatConnection,
    accountJid: jid,
    blindTrust: true,
    omemoStore: new InMemoryOmemoStore(),
    legacyStore: new InMemoryOmemoStore(),
    metaStore: new MemoryKeyMetaStore(),
    trustStore: new InMemoryTrustStore()
  })
  return { service, connection }
}

function stanza(from: string, to: string, encryptedXml: string): IncomingMessage {
  return { from, to, body: 'fallback', type: 'chat', encryptedXml }
}

const ROMEO = 'romeo@example.net'
const JULIET = 'juliet@example.net'

async function paired(): Promise<{ a: Fixture; b: Fixture; pep: PepDir }> {
  const pep: PepDir = new Map()
  const a = await makeAccount(`${ROMEO}/desk`, pep)
  const b = await makeAccount(`${JULIET}/phone`, pep)
  await a.service.publishOwn()
  await b.service.publishOwn()
  return { a, b, pep }
}

describe('OmemoService', () => {
  it('publishes bundles and device lists on both profiles', async () => {
    const pep: PepDir = new Map()
    const a = await makeAccount(`${ROMEO}/desk`, pep)
    await a.service.publishOwn()
    const nodes = pep.get(ROMEO)
    expect(nodes?.has(NAMESPACES.omemo2.devices)).toBe(true)
    expect(nodes?.has(NAMESPACES.legacy.devices)).toBe(true)
    expect(nodes?.has(`${NAMESPACES.omemo2.bundles}:${a.service.deviceId}`)).toBe(true)
    expect(nodes?.has(`${NAMESPACES.legacy.bundles}:${a.service.deviceId}`)).toBe(true)
    // both profiles advertise the same device id
    const omemo2List = nodes?.get(NAMESPACES.omemo2.devices) ?? ''
    const legacyList = nodes?.get(NAMESPACES.legacy.devices) ?? ''
    expect(omemo2List).toContain(`id='${a.service.deviceId}'`)
    expect(legacyList).toContain(`id='${a.service.deviceId}'`)
  })

  it('encrypts a body inside an SCE envelope and the peer decrypts it', async () => {
    const { a, b } = await paired()
    const xml = await a.service.encryptBody(JULIET, 'hello there')
    expect(xml).not.toBeNull()
    expect(xml).toContain(`xmlns='${NAMESPACES.omemo2.element}'`)

    const message = stanza(`${ROMEO}/desk`, JULIET, xml ?? '')
    const report = await b.service.decryptInto(message)
    expect(report.status).toBe('decrypted')
    expect(report.namespace).toBe('omemo2')
    expect(message.body).toBe('hello there')
    expect(message.encrypted).toBe(true)
    expect(message.undecryptable).toBeUndefined()
  })

  it('carries reply and replace references inside the envelope', async () => {
    const { a, b } = await paired()
    const xml = await a.service.encryptBody(JULIET, 'edited body', {
      replaceId: 'orig-1',
      replyTo: { id: 'orig-0', to: JULIET }
    })
    expect(xml).not.toBeNull()
    // nothing about the reply leaks into the serialized wire element
    expect(xml).not.toContain('orig-1')
    expect(xml).not.toContain('reply')

    const message = stanza(`${ROMEO}/desk`, JULIET, xml ?? '')
    await b.service.decryptInto(message)
    expect(message.replaceId).toBe('orig-1')
    expect(message.replyTo).toEqual({ id: 'orig-0', from: JULIET })
  })

  it('encrypts reactions and chat states as envelopes', async () => {
    const { a, b } = await paired()
    const reaction = await a.service.encryptReaction(JULIET, 'target-9', ['👍'])
    expect(reaction).not.toBeNull()
    const m1 = stanza(`${ROMEO}/desk`, JULIET, reaction ?? '')
    await b.service.decryptInto(m1)
    expect(m1.reactionTo).toEqual({ id: 'target-9', emojis: ['👍'] })

    const state = await a.service.encryptChatState(JULIET, 'composing')
    const m2 = stanza(`${ROMEO}/desk`, JULIET, state ?? '')
    await b.service.decryptInto(m2)
    expect(m2.chatState).toBe('composing')
  })

  it('never encrypts for our own devices alone when the peer has none', async () => {
    const pep: PepDir = new Map()
    const a = await makeAccount(`${ROMEO}/desk`, pep)
    const b = await makeAccount(`${JULIET}/phone`, pep)
    await a.service.publishOwn()
    await b.service.publishOwn()

    // graft a second romeo device with a resolvable bundle into his PEP
    const julietNodes = pep.get(JULIET)
    const bundle = julietNodes?.get(`${NAMESPACES.omemo2.bundles}:${b.service.deviceId}`) ?? ''
    const romeo = pep.get(ROMEO)
    romeo?.set(`${NAMESPACES.omemo2.bundles}:4242`, bundle)
    romeo?.set(
      NAMESPACES.omemo2.devices,
      `<devices xmlns='${NAMESPACES.omemo2.devices}'><device id='${a.service.deviceId}'/><device id='4242'/></devices>`
    )

    // the peer publishes nothing: even with own other devices present,
    // the result must be null rather than a self-only ciphertext
    expect(await a.service.encryptBody('ghost@example.net', 'hi')).toBeNull()
  })

  it('falls back to the legacy profile for legacy-only peers', async () => {
    const { b, pep } = await paired()
    // juliet unpublishes her omemo:2 nodes: she is a legacy-only contact
    const juliet = pep.get(JULIET)
    for (const node of [...(juliet?.keys() ?? [])]) {
      if (node.includes('omemo:2')) juliet?.delete(node)
    }
    // a third account never cached juliet's omemo:2 device list
    const pep2: PepDir = new Map([...pep])
    const c = await makeAccount('mercutio@example.net/w', pep2)
    await c.service.publishOwn()
    const xml = await c.service.encryptBody(JULIET, 'legacy hi')
    expect(xml).not.toBeNull()
    expect(xml).toContain(`xmlns='${NAMESPACES.legacy.element}'`)

    const message = stanza('mercutio@example.net/w', JULIET, xml ?? '')
    const report = await b.service.decryptInto(message)
    expect(report.status).toBe('decrypted')
    expect(report.namespace).toBe('legacy')
    expect(message.body).toBe('legacy hi')
  })

  it('flags malformed envelopes as undecryptable without throwing', async () => {
    const { b } = await paired()
    const garbage = stanza(`${ROMEO}/desk`, JULIET, '<encrypted xmlns="urn:xmpp:omemo:2"><broken')
    const report = await b.service.decryptInto(garbage)
    expect(report.status).toBe('failed')
    expect(garbage.undecryptable).toBe(true)
    expect(garbage.encrypted).toBe(true)
    expect(garbage.body).toBe('')
  })

  it('reports the sending device on well-formed but undecryptable stanzas', async () => {
    const { b } = await paired()
    const message = stanza(
      `${ROMEO}/desk`,
      JULIET,
      `<encrypted xmlns="${NAMESPACES.omemo2.element}"><header sid="4242"><keys jid="${JULIET}"><key rid="1">AAAA</key></keys></header><payload>BBBB</payload></encrypted>`
    )
    const report = await b.service.decryptInto(message)
    expect(report.status).toBe('failed')
    expect(report.sid).toBe(4242)
    expect(report.namespace).toBe('omemo2')
    expect(message.undecryptable).toBe(true)
  })

  it('sends one key transport per sender device and never repeats', async () => {
    const { a, b } = await paired()
    const first = await a.service.sendKeyTransport(JULIET, b.service.deviceId, 'omemo2')
    const second = await a.service.sendKeyTransport(JULIET, b.service.deviceId, 'omemo2')
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(a.connection.notifications).toHaveLength(1)
    expect(a.connection.notifications[0]?.to).toBe(JULIET)

    // juliet can decrypt the transport. It carries no payload
    const message = stanza(`${ROMEO}/desk`, JULIET, a.connection.notifications[0]?.xml ?? '')
    const report = await b.service.decryptInto(message)
    expect(report.status).toBe('empty')
  })

  it('never sends a key transport to a distrusted device', async () => {
    const { a, b } = await paired()
    // observe the device first so a trust record exists to distrust
    await a.service.fingerprints(JULIET)
    await a.service.setTrust(JULIET, b.service.deviceId, 'distrusted')
    const sent = await a.service.sendKeyTransport(JULIET, b.service.deviceId, 'omemo2')
    expect(sent).toBe(false)
    expect(a.connection.notifications).toHaveLength(0)
  })

  it('excludes distrusted devices from the recipient set', async () => {
    const { a, b } = await paired()
    await a.service.fingerprints(JULIET)
    await a.service.setTrust(JULIET, b.service.deviceId, 'distrusted')
    // every peer device is distrusted: no recipients, no ciphertext
    expect(await a.service.encryptBody(JULIET, 'hi')).toBeNull()
    expect(await a.service.encryptReaction(JULIET, 'm', ['x'])).toBeNull()
  })

  it('syncs trust decisions between own devices via XEP-0434', async () => {
    const { a, b } = await paired()
    await a.service.fingerprints(JULIET)
    const fp = a.service.trust.get(JULIET, b.service.deviceId)?.fingerprint ?? ''
    // automated levels stay local, manual ones broadcast
    await a.service.setTrust(JULIET, b.service.deviceId, 'undecided')
    expect(a.connection.trustMessages).toHaveLength(0)
    await a.service.setTrust(JULIET, b.service.deviceId, 'trusted')
    const tm = a.connection.trustMessages[0]
    expect(tm?.to).toBe(bareJid(ROMEO))
    expect(tm?.usage).toBe('urn:xmpp:omemo:2')
    expect(tm?.owners[0]).toMatchObject({ jid: JULIET, trust: [fp], distrust: [] })
    // the wire form applies back onto matching records only
    await a.service.setTrust(JULIET, b.service.deviceId, 'undecided')
    await a.service.applyTrustMessage(tm?.owners ?? [])
    expect(a.service.trust.get(JULIET, b.service.deviceId)?.level).toBe('trusted')
    await a.service.applyTrustMessage([
      { jid: JULIET, trust: [], distrust: ['deadbeef'.repeat(8)] }
    ])
    expect(a.service.trust.get(JULIET, b.service.deviceId)?.level).toBe('trusted')
  })
})
