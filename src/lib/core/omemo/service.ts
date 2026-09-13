// OmemoService: per-account facade that ties the OmemoManager, PEP device
// and bundle discovery, and the trust registry together. Trust decisions
// live in TrustRegistry; this file decides who gets keys and who can
// decrypt, never UI code.

import type { ChatConnection } from '$lib/core/xmpp/connection'
import { NS } from '$lib/core/xmpp/ns'
import type { IncomingMessage } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'
import { firstTag } from '$lib/utils/xml'

import {
  bytesToHex,
  el,
  formatFingerprint,
  identityFingerprintFromWire,
  NS_OMEMO2_BUNDLES,
  NS_OMEMO2_DEVICES,
  OmemoManager,
  parseDeviceList,
  parseXml,
  serializeXml,
  bodyText,
  parseSceEnvelope,
  serializeSceEnvelope,
  serializeDeviceList,
  textEnvelope,
  utf8ToBytes
} from '@quad4-software/omemo'
import type { EncryptRecipient, OmemoStore, ParsedBundle, XmlElement } from '@quad4-software/omemo'

import { IdbOmemoStore, IdbTrustStore } from './store'
import { TrustRegistry, type TrustLevel, type TrustRecord } from './trust'

export interface DeviceFingerprint {
  jid: string
  deviceId: number
  // grouped hex fingerprint for display
  fingerprint: string
  level: TrustLevel
  changed: boolean
}

export interface OmemoServiceOptions {
  connection: ChatConnection
  accountJid: string
  blindTrust?: boolean
  // injectable for tests and demo mode; defaults to IndexedDB
  omemoStore?: OmemoStore
  trustStore?: ConstructorParameters<typeof TrustRegistry>[0]
}

// A DOM element and the package's own XmlElement are different models, so
// bridge through the serialized form.
function domToXml(element: Element): XmlElement {
  const outer = (element as { outerHTML?: string }).outerHTML
  const text = outer ?? (element as unknown as { toString(): string }).toString()
  return parseXml(text)
}

export class OmemoService {
  private constructor(
    private readonly manager: OmemoManager,
    private readonly connection: ChatConnection,
    private readonly ownJid: string,
    readonly trust: TrustRegistry,
    private readonly omemoStore: OmemoStore
  ) {}

  static async create(options: OmemoServiceOptions): Promise<OmemoService> {
    const omemoStore = options.omemoStore ?? (await IdbOmemoStore.create(options.accountJid))
    const trust = new TrustRegistry(options.trustStore ?? new IdbTrustStore(options.accountJid))
    if (options.blindTrust !== undefined) trust.blindTrust = options.blindTrust
    await trust.load()
    const manager = await OmemoManager.create({
      namespace: 'omemo2',
      store: omemoStore,
      ownJid: bareJid(options.accountJid)
    })
    return new OmemoService(
      manager,
      options.connection,
      bareJid(options.accountJid),
      trust,
      omemoStore
    )
  }

  get deviceId(): number {
    return this.manager.deviceId
  }

  // True when the underlying store wraps key material at rest. Injected
  // stores that are not IdbOmemoStore are assumed to manage their own
  // at-rest protection.
  get secureStorage(): boolean {
    return !(this.omemoStore instanceof IdbOmemoStore) || this.omemoStore.secure
  }

  async ownFingerprint(): Promise<string> {
    const identity = await this.omemoStore.getIdentity()
    if (!identity) return ''
    return formatFingerprint(identityFingerprintFromWire('omemo2', identity.wirePublicKey))
  }

  // Advertise our bundle and device list on PEP. Safe to call on every
  // reconnect: republishing the same items is idempotent.
  async publishOwn(): Promise<void> {
    const bundle = serializeXml(await this.manager.buildBundle())
    this.connection.pepPublish(`${NS_OMEMO2_BUNDLES}:${this.deviceId}`, 'current', bundle)

    const known = new Set(await this.devicesOf(this.ownJid))
    known.add(this.deviceId)
    await this.omemoStore.putDeviceIds(this.ownJid, [...known])
    this.connection.pepPublish(
      NS_OMEMO2_DEVICES,
      'current',
      serializeDeviceList('omemo2', [...known])
    )
  }

  private pepItems(node: string, jid?: string): Promise<Element | null> {
    return new Promise((resolve) => {
      this.connection.pepGet(node, jid, (items) => resolve(items))
    })
  }

  // The PEP device list of a bare JID. Falls back to the last list we
  // persisted when the fetch fails.
  async devicesOf(jid: string): Promise<number[]> {
    const bare = bareJid(jid)
    const items = await this.pepItems(NS_OMEMO2_DEVICES, bare)
    const devicesEl = items === null ? null : firstTag(items, 'devices')
    if (devicesEl) {
      try {
        const ids = parseDeviceList(domToXml(devicesEl))
        await this.omemoStore.putDeviceIds(bare, ids)
        return ids
      } catch (error) {
        // fall through to the cached list
        console.warn(
          `omemo: failed to parse device list for ${bare}:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    return (await this.omemoStore.getDeviceIds(bare)) ?? []
  }

  async bundleOf(jid: string, deviceId: number): Promise<ParsedBundle | undefined> {
    const bare = bareJid(jid)
    const items = await this.pepItems(`${NS_OMEMO2_BUNDLES}:${deviceId}`, bare)
    const bundleEl = items === null ? null : firstTag(items, 'bundle')
    if (!bundleEl) return undefined
    try {
      return this.manager.parseBundle(domToXml(bundleEl))
    } catch (error) {
      console.warn(
        `omemo: failed to parse bundle for ${bare}/${deviceId}:`,
        error instanceof Error ? error.message : String(error)
      )
      return undefined
    }
  }

  // Device list enriched with fingerprints and current trust state.
  // Observing here also records first-seen devices so the UI can react
  // without a second pass.
  async fingerprints(jid: string): Promise<DeviceFingerprint[]> {
    const bare = bareJid(jid)
    const out: DeviceFingerprint[] = []
    for (const deviceId of await this.devicesOf(bare)) {
      const bundle = await this.bundleOf(bare, deviceId)
      if (!bundle) continue
      const hex = bytesToHex(identityFingerprintFromWire('omemo2', bundle.identityKeyWire))
      const record = await this.trust.observe(bare, deviceId, hex)
      out.push({
        jid: bare,
        deviceId,
        fingerprint: formatFingerprint(bundle.identityKeyCurve),
        level: record.level,
        changed: record.changed
      })
    }
    return out
  }

  async setTrust(jid: string, deviceId: number, level: TrustLevel): Promise<TrustRecord> {
    return this.trust.setLevel(bareJid(jid), deviceId, level)
  }

  setBlindTrust(enabled: boolean): void {
    this.trust.blindTrust = enabled
  }

  // Encrypt a text body for every non-distrusted device of the peer plus
  // our own other devices (so they can read what we sent). Returns the
  // serialized <encrypted> element, or null when the peer publishes no
  // OMEMO devices. opts.replaceId wraps an XEP-0308 correction inside the
  // envelope so edits stay encrypted.
  async encryptBody(
    jid: string,
    body: string,
    opts?: { replaceId?: string }
  ): Promise<string | null> {
    const bare = bareJid(jid)
    const recipients: EncryptRecipient[] = []
    for (const deviceId of await this.devicesOf(bare)) {
      if (this.trust.get(bare, deviceId)?.level === 'distrusted') continue
      const bundle = await this.bundleOf(bare, deviceId)
      if (!bundle) continue
      await this.trust.observe(
        bare,
        deviceId,
        bytesToHex(identityFingerprintFromWire('omemo2', bundle.identityKeyWire))
      )
      recipients.push({ jid: bare, deviceId, bundle })
    }
    if (recipients.length === 0) return null

    for (const deviceId of await this.devicesOf(this.ownJid)) {
      if (deviceId === this.deviceId) continue
      if (this.trust.get(this.ownJid, deviceId)?.level === 'distrusted') continue
      const bundle = await this.bundleOf(this.ownJid, deviceId)
      if (!bundle) continue
      recipients.push({ jid: this.ownJid, deviceId, bundle })
    }

    const envelope = serializeSceEnvelope({
      ...textEnvelope(
        body,
        opts?.replaceId ? [el('replace', { xmlns: NS.CORRECT, id: opts.replaceId })] : []
      ),
      from: this.ownJid,
      to: bare,
      time: new Date()
    })
    const encrypted = await this.manager.encrypt({
      recipients,
      plaintext: utf8ToBytes(envelope)
    })
    return serializeXml(encrypted)
  }

  // Decrypt an incoming stanza's <encrypted> element in place: fills
  // message.body, flags encrypted state, and records the sender's device
  // fingerprint so key changes surface in the UI.
  async decryptInto(message: IncomingMessage): Promise<void> {
    if (!message.encryptedXml) return
    const sender = bareJid(message.from)
    try {
      const result = await this.manager.decrypt(parseXml(message.encryptedXml), sender)
      if (result.senderIdentityKey) {
        const record = await this.trust.observe(
          sender,
          result.sid,
          bytesToHex(identityFingerprintFromWire('omemo2', result.senderIdentityKey))
        )
        if (record.level === 'distrusted' || record.changed) {
          message.untrustedDevice = true
        }
      }
      message.encrypted = true
      if (result.plaintext === undefined) {
        message.body = ''
        return
      }
      const envelope = parseSceEnvelope(parseXml(new TextDecoder().decode(result.plaintext)))
      // the wire body is fallback text for non-omemo clients; always
      // replace it with what the envelope actually carried
      message.body = bodyText(envelope) ?? ''
      // XEP-0308 corrections ride inside the envelope, never in the clear
      const replace = envelope.content.find((node) => node.name === 'replace')
      const replaceId = replace?.attrs['id']
      if (replaceId) message.replaceId = replaceId
    } catch (error) {
      // undecryptable stanzas still render, as a placeholder
      console.warn(
        `omemo: failed to decrypt stanza from ${sender}:`,
        error instanceof Error ? error.message : String(error)
      )
      message.encrypted = true
      message.undecryptable = true
      message.body = ''
    }
  }
}
