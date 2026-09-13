// OmemoService: per-account facade that ties the OmemoManager pair (one per
// supported namespace), PEP device and bundle discovery, and the trust
// registry together. Trust decisions live in TrustRegistry; this file
// decides who gets keys and who can decrypt, never UI code.
//
// Both XEP-0384 profiles are served: urn:xmpp:omemo:2 is preferred for
// sending, the legacy eu.siacs.conversations.axolotl profile is used only
// when a peer publishes no omemo:2 devices, and either namespace is
// accepted for decryption. Legacy has no SCE envelope, so envelope-bound
// content (replies, corrections, reactions, chat states) can only ride
// the omemo:2 profile.

import type { ChatConnection } from '$lib/core/xmpp/connection'
import type { ChatState, IncomingMessage } from '$lib/core/xmpp/stanzas'
import type { AttachmentMeta } from '$lib/core/xmpp/types'
import { bareJid } from '$lib/utils/jid'
import { firstTag } from '$lib/utils/xml'

import {
  bytesToHex,
  bytesToUtf8,
  DuplicateMessageError,
  el,
  formatFingerprint,
  identityFingerprintFromWire,
  NAMESPACES,
  OmemoManager,
  parseDeviceList,
  parseEncryptedElement,
  parseXml,
  serializeXml,
  bodyText,
  parseSceEnvelope,
  serializeSceEnvelope,
  serializeDeviceList,
  textEnvelope,
  utf8ToBytes
} from '@quad4-software/omemo'
import type {
  EncryptRecipient,
  Namespace,
  OmemoStore,
  ParsedBundle,
  XmlElement
} from '@quad4-software/omemo'

import {
  applyEnvelopeContent,
  attachmentNodes,
  chatStateNode,
  reactionsNode,
  replaceNode,
  replyNode
} from './envelope'
import { maintainKeys, MemoryKeyMetaStore, type KeyMetaStore } from './rotation'
import { IdbOmemoStore, IdbTrustStore } from './store'
import { TrustRegistry, type TrustLevel, type TrustRecord } from './trust'

export interface DeviceFingerprint {
  jid: string
  deviceId: number
  // grouped hex fingerprint for display
  fingerprint: string
  level: TrustLevel
  changed: boolean
  // which wire profile this device was discovered through
  namespace: Namespace
}

// What decryptInto made of a stanza. 'empty' is a key transport or
// heartbeat (decrypted fine, no payload). 'duplicate' is an already-seen
// stanza and must not be flagged as an error. 'failed' is undecryptable.
export interface DecryptReport {
  status: 'none' | 'decrypted' | 'empty' | 'duplicate' | 'failed'
  sid?: number | undefined
  namespace?: Namespace | undefined
}

export interface OmemoServiceOptions {
  connection: ChatConnection
  accountJid: string
  blindTrust?: boolean
  // injectable for tests and demo mode; defaults to IndexedDB
  omemoStore?: OmemoStore
  legacyStore?: OmemoStore
  metaStore?: KeyMetaStore
  trustStore?: ConstructorParameters<typeof TrustRegistry>[0]
}

// A DOM element and the package's own XmlElement are different models, so
// bridge through the serialized form.
function domToXml(element: Element): XmlElement {
  const outer = (element as { outerHTML?: string }).outerHTML
  const text = outer ?? (element as unknown as { toString(): string }).toString()
  return parseXml(text)
}

function namespaceOf(element: XmlElement): Namespace | undefined {
  const xmlns = element.attrs['xmlns']
  if (xmlns === NAMESPACES.omemo2.element) return 'omemo2'
  if (xmlns === NAMESPACES.legacy.element) return 'legacy'
  return undefined
}

export class OmemoService {
  // (sender, sid) pairs we already sent a key transport to this session;
  // XEP-0384 key recovery is one empty message per device, never a loop
  private readonly requestedKeys = new Set<string>()
  // senders whose device list we already re-fetched after traffic from an
  // unknown device, rate limited to once per namespace per session
  private readonly refreshedDevices = new Set<string>()

  private constructor(
    private readonly manager: OmemoManager,
    private readonly legacyManager: OmemoManager,
    private readonly connection: ChatConnection,
    private readonly ownJid: string,
    readonly trust: TrustRegistry,
    private readonly omemoStore: OmemoStore,
    private readonly legacyStore: OmemoStore,
    private readonly meta: KeyMetaStore
  ) {}

  static async create(options: OmemoServiceOptions): Promise<OmemoService> {
    const omemoStore = options.omemoStore ?? (await IdbOmemoStore.create(options.accountJid))
    const legacyStore =
      options.legacyStore ?? (await IdbOmemoStore.create(options.accountJid, 'oml'))
    const trust = new TrustRegistry(options.trustStore ?? new IdbTrustStore(options.accountJid))
    if (options.blindTrust !== undefined) trust.blindTrust = options.blindTrust
    await trust.load()
    const ownJid = bareJid(options.accountJid)
    const manager = await OmemoManager.create({
      namespace: 'omemo2',
      store: omemoStore,
      ownJid
    })
    // the legacy profile shares our device id so both PEP trees name the
    // same device, matching what multi-profile clients publish
    const legacyManager = await OmemoManager.create({
      namespace: 'legacy',
      store: legacyStore,
      ownJid,
      deviceId: manager.deviceId
    })
    const meta =
      options.metaStore ??
      (omemoStore instanceof IdbOmemoStore ? omemoStore : new MemoryKeyMetaStore())
    return new OmemoService(
      manager,
      legacyManager,
      options.connection,
      ownJid,
      trust,
      omemoStore,
      legacyStore,
      meta
    )
  }

  get deviceId(): number {
    return this.manager.deviceId
  }

  // True when the underlying store wraps key material at rest. Injected
  // stores that are not IdbOmemoStore are assumed to manage their own
  // at-rest protection.
  get secureStorage(): boolean {
    const omemoInsecure = this.omemoStore instanceof IdbOmemoStore && !this.omemoStore.secure
    const legacyInsecure = this.legacyStore instanceof IdbOmemoStore && !this.legacyStore.secure
    return !omemoInsecure && !legacyInsecure
  }

  async ownFingerprint(): Promise<string> {
    const identity = await this.omemoStore.getIdentity()
    if (!identity) return ''
    return formatFingerprint(identityFingerprintFromWire('omemo2', identity.wirePublicKey))
  }

  private managerFor(ns: Namespace): OmemoManager {
    return ns === 'legacy' ? this.legacyManager : this.manager
  }

  private storeFor(ns: Namespace): OmemoStore {
    return ns === 'legacy' ? this.legacyStore : this.omemoStore
  }

  // Advertise our bundles and device lists on PEP, on both namespaces.
  // Safe to call on every reconnect: republishing the same items is
  // idempotent, and maintainKeys tops up or rotates key material first.
  async publishOwn(): Promise<void> {
    await maintainKeys({
      store: this.omemoStore,
      manager: this.manager,
      meta: this.meta,
      metaKey: 'omemo2'
    })
    await maintainKeys({
      store: this.legacyStore,
      manager: this.legacyManager,
      meta: this.meta,
      metaKey: 'legacy'
    })

    this.connection.pepPublish(
      `${NAMESPACES.omemo2.bundles}:${this.deviceId}`,
      'current',
      serializeXml(await this.manager.buildBundle())
    )
    this.connection.pepPublish(
      `${NAMESPACES.legacy.bundles}:${this.deviceId}`,
      'current',
      serializeXml(await this.legacyManager.buildBundle())
    )

    const known = new Set(await this.devicesOfNs('omemo2', this.ownJid))
    known.add(this.deviceId)
    await this.omemoStore.putDeviceIds(this.ownJid, [...known])
    this.connection.pepPublish(
      NAMESPACES.omemo2.devices,
      'current',
      serializeDeviceList('omemo2', [...known])
    )

    const knownLegacy = new Set(await this.devicesOfNs('legacy', this.ownJid))
    knownLegacy.add(this.deviceId)
    await this.legacyStore.putDeviceIds(this.ownJid, [...knownLegacy])
    this.connection.pepPublish(
      NAMESPACES.legacy.devices,
      'current',
      serializeDeviceList('legacy', [...knownLegacy])
    )
  }

  private pepItems(node: string, jid?: string): Promise<Element | null> {
    return new Promise((resolve) => {
      this.connection.pepGet(node, jid, (items) => resolve(items))
    })
  }

  // The PEP device list of a bare JID for one profile. Falls back to the
  // last list we persisted when the fetch fails. The omemo:2 payload root
  // is <devices>, the legacy root is <list>; parseDeviceList takes both.
  private async devicesOfNs(ns: Namespace, jid: string): Promise<number[]> {
    const bare = bareJid(jid)
    const items = await this.pepItems(NAMESPACES[ns].devices, bare)
    const listEl = items === null ? null : (firstTag(items, 'devices') ?? firstTag(items, 'list'))
    if (listEl) {
      try {
        const ids = parseDeviceList(domToXml(listEl))
        await this.storeFor(ns).putDeviceIds(bare, ids)
        return ids
      } catch (error) {
        // fall through to the cached list
        console.warn(
          `omemo: failed to parse device list for ${bare}:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    return (await this.storeFor(ns).getDeviceIds(bare)) ?? []
  }

  async devicesOf(jid: string): Promise<number[]> {
    return this.devicesOfNs('omemo2', jid)
  }

  private async bundleOfNs(
    ns: Namespace,
    jid: string,
    deviceId: number
  ): Promise<ParsedBundle | undefined> {
    const bare = bareJid(jid)
    const items = await this.pepItems(`${NAMESPACES[ns].bundles}:${deviceId}`, bare)
    const bundleEl = items === null ? null : firstTag(items, 'bundle')
    if (!bundleEl) return undefined
    try {
      return this.managerFor(ns).parseBundle(domToXml(bundleEl))
    } catch (error) {
      console.warn(
        `omemo: failed to parse bundle for ${bare}/${deviceId}:`,
        error instanceof Error ? error.message : String(error)
      )
      return undefined
    }
  }

  async bundleOf(jid: string, deviceId: number): Promise<ParsedBundle | undefined> {
    return this.bundleOfNs('omemo2', jid, deviceId)
  }

  // Device list enriched with fingerprints and current trust state.
  // Observing here also records first-seen devices so the UI can react
  // without a second pass. omemo:2 devices come first; a legacy-only peer
  // still lists its devices so they can be verified.
  async fingerprints(jid: string): Promise<DeviceFingerprint[]> {
    const bare = bareJid(jid)
    const out: DeviceFingerprint[] = []
    for (const ns of ['omemo2', 'legacy'] as const) {
      for (const deviceId of await this.devicesOfNs(ns, bare)) {
        const bundle = await this.bundleOfNs(ns, bare, deviceId)
        if (!bundle) continue
        const hex = bytesToHex(identityFingerprintFromWire(ns, bundle.identityKeyWire))
        const record = await this.trust.observe(bare, deviceId, hex)
        out.push({
          jid: bare,
          deviceId,
          fingerprint: formatFingerprint(bundle.identityKeyCurve),
          level: record.level,
          changed: record.changed,
          namespace: ns
        })
      }
    }
    return out
  }

  async setTrust(jid: string, deviceId: number, level: TrustLevel): Promise<TrustRecord> {
    return this.trust.setLevel(bareJid(jid), deviceId, level)
  }

  setBlindTrust(enabled: boolean): void {
    this.trust.blindTrust = enabled
  }

  // Non-distrusted devices of the peer with a resolvable bundle. A peer
  // with no entries here must produce a null result from the encrypt
  // paths so the caller can fall back to plaintext - encrypting only for
  // our own other devices would send something the peer cannot read.
  private async peerRecipients(ns: Namespace, bare: string): Promise<EncryptRecipient[]> {
    const recipients: EncryptRecipient[] = []
    for (const deviceId of await this.devicesOfNs(ns, bare)) {
      if (this.trust.get(bare, deviceId)?.level === 'distrusted') continue
      const bundle = await this.bundleOfNs(ns, bare, deviceId)
      if (!bundle) continue
      await this.trust.observe(
        bare,
        deviceId,
        bytesToHex(identityFingerprintFromWire(ns, bundle.identityKeyWire))
      )
      recipients.push({ jid: bare, deviceId, bundle })
    }
    return recipients
  }

  // Our own other devices, so our other resources can read what we sent.
  private async ownRecipients(ns: Namespace): Promise<EncryptRecipient[]> {
    const recipients: EncryptRecipient[] = []
    for (const deviceId of await this.devicesOfNs(ns, this.ownJid)) {
      if (deviceId === this.deviceId) continue
      if (this.trust.get(this.ownJid, deviceId)?.level === 'distrusted') continue
      const bundle = await this.bundleOfNs(ns, this.ownJid, deviceId)
      if (!bundle) continue
      recipients.push({ jid: this.ownJid, deviceId, bundle })
    }
    return recipients
  }

  // Encrypt an SCE envelope (omemo:2 only) for the peer and our own other
  // devices. Returns the serialized <encrypted> element, or null when the
  // peer publishes no usable omemo:2 devices.
  private async encryptEnvelope(jid: string, content: XmlElement[]): Promise<string | null> {
    const bare = bareJid(jid)
    const peer = await this.peerRecipients('omemo2', bare)
    if (peer.length === 0) return null
    const recipients = [...peer, ...(await this.ownRecipients('omemo2'))]
    const envelope = serializeSceEnvelope({
      content,
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

  // Encrypt a text body. opts.replaceId wraps an XEP-0308 correction and
  // opts.replyTo an XEP-0461 reply inside the envelope so edits and quotes
  // stay encrypted. When the peer is legacy-only the raw body is sent
  // through that profile; legacy cannot carry envelope content, so reply
  // and replace metadata are dropped there rather than sent in the clear.
  async encryptBody(
    jid: string,
    body: string,
    opts?: { replaceId?: string; replyTo?: { id: string; to: string } }
  ): Promise<string | null> {
    const bare = bareJid(jid)
    const content = textEnvelope(body, [
      ...(opts?.replaceId ? [replaceNode(opts.replaceId)] : []),
      ...(opts?.replyTo ? [replyNode(opts.replyTo)] : [])
    ]).content
    const omemo2 = await this.encryptEnvelope(bare, content)
    if (omemo2 !== null) return omemo2

    const peer = await this.peerRecipients('legacy', bare)
    if (peer.length === 0) return null
    const recipients = [...peer, ...(await this.ownRecipients('legacy'))]
    const encrypted = await this.legacyManager.encrypt({
      recipients,
      plaintext: utf8ToBytes(body)
    })
    return serializeXml(encrypted)
  }

  // Encrypt an attachment announcement (XEP-0066 url plus optional
  // XEP-0446 metadata) inside an envelope. The url is also the envelope
  // body so body-only clients still share it.
  async encryptAttachment(jid: string, url: string, meta?: AttachmentMeta): Promise<string | null> {
    return this.encryptEnvelope(jid, [el('body', {}, [], url), ...attachmentNodes(url, meta)])
  }

  // Encrypt a XEP-0444 reaction update. Returns null for peers without
  // omemo:2 devices; callers fall back to a cleartext reactions stanza.
  async encryptReaction(jid: string, targetId: string, emojis: string[]): Promise<string | null> {
    return this.encryptEnvelope(jid, [reactionsNode(targetId, emojis)])
  }

  // Encrypt a XEP-0085 chat state. Same fallback contract as
  // encryptReaction.
  async encryptChatState(jid: string, state: ChatState): Promise<string | null> {
    return this.encryptEnvelope(jid, [chatStateNode(state)])
  }

  // XEP-0384 recovery for undecryptable stanzas: send one empty OMEMO
  // message (a key transport) to the sender device that produced the
  // failed stanza, so it can complete or repair the session. Empty
  // messages exist purely to transfer key material, which is why this is
  // allowed to build a session without prior trust. Rate limited to once
  // per (sender, sid) per app session and skipped for devices the user
  // distrusted. Returns true when a transport stanza was actually sent.
  async sendKeyTransport(jid: string, sid: number, ns: Namespace): Promise<boolean> {
    const bare = bareJid(jid)
    const key = `${ns}:${bare}/${sid}`
    if (this.requestedKeys.has(key)) return false
    this.requestedKeys.add(key)
    if (this.trust.get(bare, sid)?.level === 'distrusted') return false
    try {
      const bundle = await this.bundleOfNs(ns, bare, sid)
      const encrypted = await this.managerFor(ns).encrypt({
        recipients: [{ jid: bare, deviceId: sid, ...(bundle ? { bundle } : {}) }],
        empty: true
      })
      this.connection.sendEncryptedNotification(bare, serializeXml(encrypted))
      return true
    } catch (error) {
      console.warn(
        `omemo: key transport to ${bare}/${sid} failed:`,
        error instanceof Error ? error.message : String(error)
      )
      return false
    }
  }

  // XEP-0384: traffic from a device id that is not on the known device
  // list warrants one direct re-fetch of that user's devices node.
  private async refreshDevicesOnce(sender: string, sid: number, ns: Namespace): Promise<void> {
    const known = (await this.storeFor(ns).getDeviceIds(sender)) ?? []
    if (known.includes(sid)) return
    const key = `${ns}:${sender}`
    if (this.refreshedDevices.has(key)) return
    this.refreshedDevices.add(key)
    await this.devicesOfNs(ns, sender)
  }

  // Decrypt an incoming stanza's <encrypted> element in place: fills
  // message.body plus any envelope content (reply, replace, reactions,
  // chat states, attachments), flags encrypted state, and records the
  // sender's device fingerprint so key changes surface in the UI. The
  // report tells the caller which device sent it and whether a key
  // transport might help, even when decryption itself failed.
  async decryptInto(message: IncomingMessage): Promise<DecryptReport> {
    if (!message.encryptedXml) return { status: 'none' }
    const sender = bareJid(message.from)

    let element: XmlElement | undefined
    let ns: Namespace | undefined
    let sid: number | undefined
    try {
      element = parseXml(message.encryptedXml)
      ns = namespaceOf(element)
      if (ns !== undefined) {
        sid = parseEncryptedElement(element, ns).sid
      }
    } catch {
      // malformed payload: falls through to the tombstone below
    }
    if (element === undefined || ns === undefined) {
      message.encrypted = true
      message.undecryptable = true
      message.body = ''
      return { status: 'failed' }
    }
    if (sid !== undefined) void this.refreshDevicesOnce(sender, sid, ns)

    try {
      const result = await this.managerFor(ns).decrypt(element, sender)
      if (result.senderIdentityKey) {
        const record = await this.trust.observe(
          sender,
          result.sid,
          bytesToHex(identityFingerprintFromWire(ns, result.senderIdentityKey))
        )
        if (record.level === 'distrusted' || record.changed) {
          message.untrustedDevice = true
        }
      }
      message.encrypted = true
      delete message.undecryptable
      if (result.plaintext === undefined) {
        message.body = ''
        return { status: 'empty', sid: result.sid, namespace: ns }
      }
      if (ns === 'legacy') {
        // the legacy profile has no SCE envelope; the payload is the body
        message.body = bytesToUtf8(result.plaintext)
        return { status: 'decrypted', sid: result.sid, namespace: ns }
      }
      const envelope = parseSceEnvelope(parseXml(bytesToUtf8(result.plaintext)))
      // the wire body is fallback text for non-omemo clients; always
      // replace it with what the envelope actually carried
      message.body = bodyText(envelope) ?? ''
      applyEnvelopeContent(message, envelope.content)
      return { status: 'decrypted', sid: result.sid, namespace: ns }
    } catch (error) {
      if (error instanceof DuplicateMessageError) {
        // XEP-0384: an already-decrypted stanza is ignored, not an error
        message.encrypted = true
        message.body = ''
        return { status: 'duplicate', sid, namespace: ns }
      }
      // undecryptable stanzas still render, as a placeholder
      console.warn(
        `omemo: failed to decrypt stanza from ${sender}:`,
        error instanceof Error ? error.message : String(error)
      )
      message.encrypted = true
      message.undecryptable = true
      message.body = ''
      return { status: 'failed', sid, namespace: ns }
    }
  }
}
