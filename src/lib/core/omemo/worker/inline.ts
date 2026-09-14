// InlineOmemoCrypto: the in-process implementation of the crypto
// boundary. It owns the same manager pair and stores the worker would,
// just on the main thread. Used when callers inject their own stores
// (tests, untrusted accounts), when Worker is unavailable, and as the
// fallback when a spawn fails.

import { maintainKeys, MemoryKeyMetaStore, type KeyMetaStore } from '../rotation'
import { IdbOmemoStore } from '../store'

import { OmemoManager } from '@quad4-software/badinage-omemo'
import type {
  DecryptResult,
  EncryptInput,
  Namespace,
  OmemoStore,
  ParsedBundle,
  XmlElement
} from '@quad4-software/badinage-omemo'

import type { OmemoCrypto, OmemoCryptoOptions } from './crypto'

export class InlineOmemoCrypto implements OmemoCrypto {
  private constructor(
    private readonly managers: Record<Namespace, OmemoManager>,
    private readonly stores: Record<Namespace, OmemoStore>,
    private readonly meta: KeyMetaStore,
    readonly secure: boolean,
    readonly keyWrapError: unknown
  ) {}

  get deviceId(): number {
    return this.managers.omemo2.deviceId
  }

  static async create(options: OmemoCryptoOptions): Promise<InlineOmemoCrypto> {
    const omemoStore = options.omemoStore ?? (await IdbOmemoStore.create(options.accountJid))
    const legacyStore =
      options.legacyStore ?? (await IdbOmemoStore.create(options.accountJid, 'oml'))
    const omemo2 = await OmemoManager.create({
      namespace: 'omemo2',
      store: omemoStore,
      ownJid: options.ownJid
    })
    // the legacy profile shares our device id so both PEP trees name
    // the same device, matching what multi-profile clients publish
    const legacy = await OmemoManager.create({
      namespace: 'legacy',
      store: legacyStore,
      ownJid: options.ownJid,
      deviceId: omemo2.deviceId
    })
    const meta =
      options.metaStore ??
      (omemoStore instanceof IdbOmemoStore ? omemoStore : new MemoryKeyMetaStore())
    const secure =
      !(omemoStore instanceof IdbOmemoStore && !omemoStore.secure) &&
      !(legacyStore instanceof IdbOmemoStore && !legacyStore.secure)
    const keyWrapError =
      (omemoStore instanceof IdbOmemoStore ? omemoStore.keyWrapError : undefined) ??
      (legacyStore instanceof IdbOmemoStore ? legacyStore.keyWrapError : undefined)
    return new InlineOmemoCrypto(
      { omemo2, legacy },
      { omemo2: omemoStore, legacy: legacyStore },
      meta,
      secure,
      keyWrapError
    )
  }

  encrypt(ns: Namespace, input: EncryptInput): Promise<XmlElement> {
    return this.managers[ns].encrypt(input)
  }

  decrypt(ns: Namespace, element: XmlElement, senderJid: string): Promise<DecryptResult> {
    return this.managers[ns].decrypt(element, senderJid)
  }

  buildBundle(ns: Namespace): Promise<XmlElement> {
    return this.managers[ns].buildBundle()
  }

  parseBundle(ns: Namespace, element: XmlElement): Promise<ParsedBundle> {
    return Promise.resolve(this.managers[ns].parseBundle(element))
  }

  async identityKey(ns: Namespace): Promise<Uint8Array | undefined> {
    return (await this.stores[ns].getIdentity())?.wirePublicKey
  }

  getDeviceIds(ns: Namespace, jid: string): Promise<number[] | undefined> {
    return this.stores[ns].getDeviceIds(jid)
  }

  putDeviceIds(ns: Namespace, jid: string, ids: number[]): Promise<void> {
    return this.stores[ns].putDeviceIds(jid, ids)
  }

  // the meta store is shared across profiles like the old service did:
  // metaKey keeps each profile's rotation bookkeeping apart
  maintain(ns: Namespace): Promise<void> {
    return maintainKeys({
      store: this.stores[ns],
      manager: this.managers[ns],
      meta: this.meta,
      metaKey: ns
    }).then(() => undefined)
  }

  dispose(): void {
    // nothing owns resources in-process
  }
}
