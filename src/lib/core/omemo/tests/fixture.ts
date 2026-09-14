// Shared in-memory PEP directory and fake connection for omemo service
// tests. Mirrors the fixture embedded in service.test.ts: accounts
// publish to and fetch from one shared map so round trips exercise the
// real wire path without a server.

import { DOMParser } from '@xmldom/xmldom'

import type { ChatConnection } from '$lib/core/xmpp/connection'
import type { IncomingMessage, TrustOwner } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

import { InMemoryOmemoStore } from '@quad4-software/badinage-omemo'

import { MemoryKeyMetaStore } from '../rotation'
import { OmemoService } from '../service'
import { InMemoryTrustStore } from '../trust'

const parser = new DOMParser()

// bare jid -> pubsub node -> latest published payload xml
export type PepDir = Map<string, Map<string, string>>

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

export interface Fixture {
  service: OmemoService
  connection: FakeConnection
}

export async function makeAccount(jid: string, pep: PepDir): Promise<Fixture> {
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

export function stanza(from: string, to: string, encryptedXml: string): IncomingMessage {
  return { from, to, body: 'fallback', type: 'chat', encryptedXml }
}
