// OmemoService: per-account facade tying the OmemoManager pair (one per
// supported namespace), PEP device and bundle discovery, and the trust
// registry together. This file decides who gets keys and who can
// decrypt, never UI code.
//
// Both XEP-0384 profiles are served: urn:xmpp:omemo:2 is preferred for
// sending, the legacy eu.siacs.conversations.axolotl profile is used only
// when a peer publishes no omemo:2 devices, and either namespace is
// accepted for decryption. Legacy has no SCE envelope, so envelope-bound
// content can only ride the omemo:2 profile.

import type { ChatConnection } from '$lib/core/xmpp/connection'
import type { ChatState, IncomingMessage, TrustOwner } from '$lib/core/xmpp/stanzas'
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
} from '@quad4-software/badinage-omemo'
import type {
  EncryptRecipient,
  Namespace,
  OmemoStore,
  ParsedBundle,
  XmlElement
} from '@quad4-software/badinage-omemo'

import {
  applyEnvelopeContent,
  attachmentNodes,
  chatStateNode,
  ephemeralNode,
  geolocNode,
  reactionsNode,
  replaceNode,
  replyNode,
  spoilerNode
} from './envelope'
import type { KeyMetaStore } from './rotation'
import { IdbTrustStore } from './store'
import { TrustRegistry, trustOwner, type TrustLevel, type TrustRecord } from './trust'
import { createOmemoCrypto } from './worker/crypto'
import type { OmemoCrypto } from './worker/crypto'

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
// heartbeat, 'duplicate' an already-seen stanza, 'failed' undecryptable.
export interface DecryptReport {
  status: 'none' | 'decrypted' | 'empty' | 'duplicate' | 'failed'
  sid?: number | undefined
  namespace?: Namespace | undefined
}

// Envelope extras that ride alongside the body of an encrypted message:
// corrections, replies, spoilers, ephemeral timers and geoloc.
export interface EnvelopeContentOpts {
  replaceId?: string
  replyTo?: { id: string; to: string } | undefined
  spoilerHint?: string | undefined
  ephemeral?: number | undefined
  geoloc?: { lat: number; lon: number; accuracy?: number | undefined } | undefined
}

export interface OmemoServiceOptions {
  connection: ChatConnection
  accountJid: string
  blindTrust?: boolean
  // injectable for tests and demo mode. Defaults to IndexedDB
  omemoStore?: OmemoStore
  legacyStore?: OmemoStore
  metaStore?: KeyMetaStore
  trustStore?: ConstructorParameters<typeof TrustRegistry>[0]
}

// Bridge a DOM element to the package's own XmlElement via its xml text
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
  // (sender, sid) pairs we already sent a key transport to this session
  private readonly requestedKeys = new Set<string>()
  // senders whose device list we already re-fetched after traffic from
  // an unknown device, rate limited to once per session
  private readonly refreshedDevices = new Set<string>()

  private constructor(
    private readonly crypto: OmemoCrypto,
    private readonly connection: ChatConnection,
    private readonly ownJid: string,
    readonly trust: TrustRegistry
  ) {}

  static async create(options: OmemoServiceOptions): Promise<OmemoService> {
    const trust = new TrustRegistry(options.trustStore ?? new IdbTrustStore(options.accountJid))
    if (options.blindTrust !== undefined) trust.blindTrust = options.blindTrust
    await trust.load()
    const ownJid = bareJid(options.accountJid)
    // sessions, ratchets and key material live behind this boundary,
    // in a dedicated worker whenever one can be spawned
    const crypto = await createOmemoCrypto({
      accountJid: options.accountJid,
      ownJid,
      ...(options.omemoStore !== undefined ? { omemoStore: options.omemoStore } : {}),
      ...(options.legacyStore !== undefined ? { legacyStore: options.legacyStore } : {}),
      ...(options.metaStore !== undefined ? { metaStore: options.metaStore } : {})
    })
    return new OmemoService(crypto, options.connection, ownJid, trust)
  }

  get deviceId(): number {
    return this.crypto.deviceId
  }

  // True when the underlying store wraps key material at rest. Injected
  // stores that are not IdbOmemoStore are assumed to manage their own
  // at-rest protection.
  get secureStorage(): boolean {
    return this.crypto.secure
  }

  // release the crypto worker (or no-op inline). Pending calls reject.
  // Called when the owning account is removed
  dispose(): void {
    this.crypto.dispose()
  }

  async ownFingerprint(): Promise<string> {
    const wire = await this.crypto.identityKey('omemo2')
    if (!wire) return ''
    return formatFingerprint(identityFingerprintFromWire('omemo2', wire))
  }

  // Advertise our bundles and device lists on PEP, on both namespaces.
  // Safe on every reconnect: republishing the same items is idempotent.
  async publishOwn(): Promise<void> {
    await this.crypto.maintain('omemo2')
    await this.crypto.maintain('legacy')

    this.connection.pepPublish(
      `${NAMESPACES.omemo2.bundles}:${this.deviceId}`,
      'current',
      serializeXml(await this.crypto.buildBundle('omemo2'))
    )
    this.connection.pepPublish(
      `${NAMESPACES.legacy.bundles}:${this.deviceId}`,
      'current',
      serializeXml(await this.crypto.buildBundle('legacy'))
    )

    const known = new Set(await this.devicesOfNs('omemo2', this.ownJid))
    known.add(this.deviceId)
    await this.crypto.putDeviceIds('omemo2', this.ownJid, [...known])
    this.connection.pepPublish(
      NAMESPACES.omemo2.devices,
      'current',
      serializeDeviceList('omemo2', [...known])
    )

    const knownLegacy = new Set(await this.devicesOfNs('legacy', this.ownJid))
    knownLegacy.add(this.deviceId)
    await this.crypto.putDeviceIds('legacy', this.ownJid, [...knownLegacy])
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
  // last persisted list when the fetch fails.
  private async devicesOfNs(ns: Namespace, jid: string): Promise<number[]> {
    const bare = bareJid(jid)
    const items = await this.pepItems(NAMESPACES[ns].devices, bare)
    const listEl = items === null ? null : (firstTag(items, 'devices') ?? firstTag(items, 'list'))
    if (listEl) {
      try {
        const ids = parseDeviceList(domToXml(listEl))
        await this.crypto.putDeviceIds(ns, bare, ids)
        return ids
      } catch (error) {
        // fall through to the cached list
        console.warn(
          `omemo: failed to parse device list for ${bare}:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    return (await this.crypto.getDeviceIds(ns, bare)) ?? []
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
      return await this.crypto.parseBundle(ns, domToXml(bundleEl))
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
  // Observing records first-seen devices so the UI can react. A
  // legacy-only peer still lists its devices for verify.
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
    const record = await this.trust.setLevel(bareJid(jid), deviceId, level)
    // XEP-0434: manual decisions sync to our other devices. Automated
    // levels (undecided, blind) stay local per the spec
    if (level === 'trusted' || level === 'distrusted') {
      const usage = (await this.devicesOfNs('omemo2', record.jid)).includes(deviceId)
        ? NAMESPACES.omemo2.element
        : NAMESPACES.legacy.element
      this.connection.sendTrustMessage(bareJid(this.ownJid), usage, [trustOwner(record, level)])
    }
    return record
  }

  // XEP-0434: trust decisions synced from our other devices
  applyTrustMessage(owners: TrustOwner[]): Promise<void> {
    return this.trust.applySync(owners)
  }

  setBlindTrust(enabled: boolean): void {
    this.trust.blindTrust = enabled
  }

  // Non-distrusted devices of the peer with a resolvable bundle. A peer
  // with none yields null so the caller falls back to plaintext.
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

  private async encryptEnvelope(jid: string, content: XmlElement[]): Promise<string | null> {
    return this.encryptEnvelopeFor(jid, [jid], content)
  }

  // Envelope addressed to toJid with keys covering every member plus
  // our own devices. Null when any member lacks a usable device, the
  // caller falls back to plaintext for everyone
  private async encryptEnvelopeFor(
    toJid: string,
    memberJids: string[],
    content: XmlElement[]
  ): Promise<string | null> {
    const peers: EncryptRecipient[] = []
    for (const member of memberJids) {
      const recipients = await this.peerRecipients('omemo2', bareJid(member))
      if (recipients.length === 0) return null
      peers.push(...recipients)
    }
    const recipients = [...peers, ...(await this.ownRecipients('omemo2'))]
    const envelope = serializeSceEnvelope({
      content,
      from: this.ownJid,
      to: bareJid(toJid),
      time: new Date()
    })
    const encrypted = await this.crypto.encrypt('omemo2', {
      recipients,
      plaintext: utf8ToBytes(envelope)
    })
    return serializeXml(encrypted)
  }

  // Encrypt a text body plus envelope content (replies, corrections,
  // spoilers, ephemeral timer, geoloc). Legacy-only peers cannot carry
  // envelope content, so that metadata is dropped there.
  async encryptBody(jid: string, body: string, opts?: EnvelopeContentOpts): Promise<string | null> {
    const bare = bareJid(jid)
    const content = textEnvelope(body, [
      ...(opts?.replaceId ? [replaceNode(opts.replaceId)] : []),
      ...(opts?.replyTo ? [replyNode(opts.replyTo)] : []),
      ...(opts?.spoilerHint !== undefined ? [spoilerNode(opts.spoilerHint)] : []),
      ...(opts?.ephemeral !== undefined ? [ephemeralNode(opts.ephemeral)] : []),
      ...(opts?.geoloc ? [geolocNode(opts.geoloc)] : [])
    ]).content
    const omemo2 = await this.encryptEnvelope(bare, content)
    if (omemo2 !== null) return omemo2

    const peer = await this.peerRecipients('legacy', bare)
    if (peer.length === 0) return null
    const recipients = [...peer, ...(await this.ownRecipients('legacy'))]
    const encrypted = await this.crypto.encrypt('legacy', {
      recipients,
      plaintext: utf8ToBytes(body)
    })
    return serializeXml(encrypted)
  }

  // Group OMEMO: one groupchat stanza whose keys cover every member's
  // devices, null when any member lacks usable devices
  async encryptRoomBody(
    roomJid: string,
    memberJids: string[],
    body: string,
    opts?: EnvelopeContentOpts
  ): Promise<string | null> {
    const content = textEnvelope(body, [
      ...(opts?.replaceId ? [replaceNode(opts.replaceId)] : []),
      ...(opts?.replyTo ? [replyNode(opts.replyTo)] : []),
      ...(opts?.spoilerHint !== undefined ? [spoilerNode(opts.spoilerHint)] : []),
      ...(opts?.ephemeral !== undefined ? [ephemeralNode(opts.ephemeral)] : []),
      ...(opts?.geoloc ? [geolocNode(opts.geoloc)] : [])
    ]).content
    return this.encryptEnvelopeFor(bareJid(roomJid), memberJids, content)
  }

  // Encrypt an attachment announcement inside an envelope. The url is
  // also the envelope body so body-only clients still share it.
  async encryptAttachment(jid: string, url: string, meta?: AttachmentMeta): Promise<string | null> {
    return this.encryptEnvelope(jid, [el('body', {}, [], url), ...attachmentNodes(url, meta)])
  }

  // Encrypt a XEP-0444 reaction update. Returns null for peers without
  // omemo:2 devices. Callers fall back to a cleartext reactions stanza.
  async encryptReaction(jid: string, targetId: string, emojis: string[]): Promise<string | null> {
    return this.encryptEnvelope(jid, [reactionsNode(targetId, emojis)])
  }

  // Encrypt a XEP-0085 chat state. Same fallback contract as encryptReaction
  async encryptChatState(jid: string, state: ChatState): Promise<string | null> {
    return this.encryptEnvelope(jid, [chatStateNode(state)])
  }

  // XEP-0384 recovery for undecryptable stanzas: send one empty OMEMO
  // message (a key transport) to the device that produced the failed
  // stanza so it can repair the session. Rate limited to once per
  // (sender, sid) per app session, skipped for distrusted devices.
  async sendKeyTransport(jid: string, sid: number, ns: Namespace): Promise<boolean> {
    const bare = bareJid(jid)
    const key = `${ns}:${bare}/${sid}`
    if (this.requestedKeys.has(key)) return false
    this.requestedKeys.add(key)
    if (this.trust.get(bare, sid)?.level === 'distrusted') return false
    try {
      const bundle = await this.bundleOfNs(ns, bare, sid)
      const encrypted = await this.crypto.encrypt(ns, {
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
    const known = (await this.crypto.getDeviceIds(ns, sender)) ?? []
    if (known.includes(sid)) return
    const key = `${ns}:${sender}`
    if (this.refreshedDevices.has(key)) return
    this.refreshedDevices.add(key)
    await this.devicesOfNs(ns, sender)
  }

  // Decrypt an incoming stanza's <encrypted> element in place: fills
  // message.body plus any envelope content, flags encrypted state, and
  // records the sender's device fingerprint so key changes surface in
  // the UI. The report names the device and whether a key transport
  // might help, even when decryption itself failed.
  async decryptInto(message: IncomingMessage, senderJid?: string): Promise<DecryptReport> {
    if (!message.encryptedXml) return { status: 'none' }
    // sessions key on the sender's real jid, not a room nick
    const sender = bareJid(senderJid ?? message.from)

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
      const result = await this.crypto.decrypt(ns, element, sender)
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
        // the legacy profile has no SCE envelope. The payload is the body
        message.body = bytesToUtf8(result.plaintext)
        return { status: 'decrypted', sid: result.sid, namespace: ns }
      }
      const envelope = parseSceEnvelope(parseXml(bytesToUtf8(result.plaintext)))
      // the wire body is fallback text for non-omemo clients. Always
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
