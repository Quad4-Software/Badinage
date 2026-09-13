import { describe, expect, it } from 'vitest'

import type { Namespace } from '../src/constants'
import { bytesToUtf8, utf8ToBytes } from '../src/internal/bytes'
import { parseXml } from '../src/internal/xml'
import { OmemoManager } from '../src/manager'
import { parseBundle } from '../src/protocol/wire/bundle'
import {
  bodyText,
  parseSceEnvelope,
  serializeSceEnvelope,
  textEnvelope
} from '../src/protocol/wire/sce'
import { InMemoryOmemoStore } from '../src/store/memory'
import { bundleFingerprint } from '../src/trust'

async function makeManager(namespace: Namespace, jid: string, deviceId: number) {
  return OmemoManager.create({
    namespace,
    store: new InMemoryOmemoStore(),
    ownJid: jid,
    deviceId
  })
}

for (const namespace of ['omemo2', 'legacy'] as const) {
  describe(`manager end to end (${namespace})`, () => {
    it('encrypts and decrypts a message between two devices', async () => {
      const alice = await makeManager(namespace, 'alice@example.org', 1)
      const bob = await makeManager(namespace, 'bob@example.org', 2)

      const bobBundleXml = await bob.buildBundle()
      const bobBundle = parseBundle(bobBundleXml, namespace)
      expect(bundleFingerprint(bobBundle).length).toBeGreaterThan(0)

      const plaintext =
        namespace === 'omemo2'
          ? utf8ToBytes(
              serializeSceEnvelope({
                ...textEnvelope('hi bob'),
                from: 'alice@example.org',
                to: 'bob@example.org',
                time: new Date(0)
              })
            )
          : utf8ToBytes('hi bob')

      const encrypted = await alice.encrypt({
        recipients: [{ jid: 'bob@example.org', deviceId: 2, bundle: bobBundle }],
        plaintext
      })

      const result = await bob.decrypt(encrypted, 'alice@example.org')
      expect(result.empty).toBe(false)
      expect(result.wasKeyExchange).toBe(true)
      expect(result.sid).toBe(1)
      if (namespace === 'omemo2') {
        const envelope = parseSceEnvelope(
          parseXml(bytesToUtf8(result.plaintext ?? new Uint8Array()))
        )
        expect(bodyText(envelope)).toBe('hi bob')
        expect(envelope.from).toBe('alice@example.org')
      } else {
        expect(bytesToUtf8(result.plaintext ?? new Uint8Array())).toBe('hi bob')
      }

      // Bob replies; alice has an unconfirmed session which becomes confirmed.
      const reply = await bob.encrypt({
        recipients: [{ jid: 'alice@example.org', deviceId: 1 }],
        plaintext:
          namespace === 'omemo2'
            ? utf8ToBytes(serializeSceEnvelope(textEnvelope('hello alice')))
            : utf8ToBytes('hello alice')
      })
      const replyResult = await alice.decrypt(reply, 'bob@example.org')
      expect(replyResult.empty).toBe(false)

      // Now alice sends a plain (non-kex) message.
      const second = await alice.encrypt({
        recipients: [{ jid: 'bob@example.org', deviceId: 2 }],
        plaintext:
          namespace === 'omemo2'
            ? utf8ToBytes(serializeSceEnvelope(textEnvelope('second')))
            : utf8ToBytes('second')
      })
      const secondResult = await bob.decrypt(second, 'alice@example.org')
      expect(secondResult.wasKeyExchange).toBe(false)
    })

    it('sends an empty heartbeat message', async () => {
      const alice = await makeManager(namespace, 'alice@example.org', 1)
      const bob = await makeManager(namespace, 'bob@example.org', 2)
      const bobBundle = parseBundle(await bob.buildBundle(), namespace)
      const encrypted = await alice.encrypt({
        recipients: [{ jid: 'bob@example.org', deviceId: 2, bundle: bobBundle }],
        empty: true
      })
      const result = await bob.decrypt(encrypted, 'alice@example.org')
      expect(result.empty).toBe(true)
      expect(result.plaintext).toBeUndefined()
    })

    it('decrypts a resent key exchange against an existing session', async () => {
      const alice = await makeManager(namespace, 'alice@example.org', 1)
      const bob = await makeManager(namespace, 'bob@example.org', 2)
      const bobBundle = parseBundle(await bob.buildBundle(), namespace)
      const plaintext =
        namespace === 'omemo2'
          ? utf8ToBytes(serializeSceEnvelope(textEnvelope('kex resend')))
          : utf8ToBytes('kex resend')
      const encrypted = await alice.encrypt({
        recipients: [{ jid: 'bob@example.org', deviceId: 2, bundle: bobBundle }],
        plaintext
      })
      const first = await bob.decrypt(encrypted, 'alice@example.org')
      expect(first.wasKeyExchange).toBe(true)
      // Re-deliver the identical element: session exists and kex unwraps.
      const again = await bob.decrypt(encrypted, 'alice@example.org')
      expect(again.wasKeyExchange).toBe(true)
    })
  })
}
