// Worker entry: owns both OmemoManager instances, their IndexedDB
// stores and the key-wrap key. The main thread never sees private key
// material, and every request runs through a strict FIFO so ratchet
// session and prekey mutations can never interleave at await points.
// That FIFO is the whole reason this file exists: the old in-process
// path let concurrent decrypt calls race session load/save.
//
// install() is exported separately from the auto-attach at the bottom
// so unit tests can drive the real dispatch loop through a fake scope.
// All state lives inside the install closure: two installs never share
// managers, matching what two real workers would do.

import { maintainKeys, type KeyMetaStore } from '../rotation'
import { IdbOmemoStore } from '../store'

import { packError } from './protocol'
import type { CryptoArgs, CryptoRequest, InitResult, WorkerScope } from './protocol'

import { OmemoManager } from '@quad4-software/badinage-omemo'
import type { Namespace, OmemoStore } from '@quad4-software/badinage-omemo'

interface WorkerState {
  managers: Record<Namespace, OmemoManager>
  stores: Record<Namespace, OmemoStore>
  meta: KeyMetaStore
  init: InitResult
}

// What init needs from the platform: the two profile stores plus the
// meta store rotation bookkeeping lives in. The production backend is
// IndexedDB. Tests substitute in-memory stores through install()
export interface StoreBackend {
  omemo2: OmemoStore
  legacy: OmemoStore
  meta: KeyMetaStore
  secure: boolean
  keyWrapError?: unknown
}

export type BackendFactory = (accountJid: string) => Promise<StoreBackend>

async function idbBackend(accountJid: string): Promise<StoreBackend> {
  const omemo2 = await IdbOmemoStore.create(accountJid)
  const legacy = await IdbOmemoStore.create(accountJid, 'oml')
  const keyWrapError = omemo2.keyWrapError ?? legacy.keyWrapError
  return {
    omemo2,
    legacy,
    meta: omemo2,
    secure: omemo2.secure && legacy.secure,
    ...(keyWrapError !== undefined ? { keyWrapError } : {})
  }
}

export function install(scope: WorkerScope, backend: BackendFactory = idbBackend): void {
  let state: WorkerState | undefined

  async function init(args: CryptoArgs): Promise<InitResult> {
    // init is idempotent per worker: a repeated call reuses the loaded
    // state instead of rebuilding managers over the same stores
    if (state !== undefined) return state.init
    const ownJid = args.ownJid ?? ''
    const stores = await backend(args.accountJid ?? '')
    const omemo2 = await OmemoManager.create({
      namespace: 'omemo2',
      store: stores.omemo2,
      ownJid
    })
    // the legacy profile shares our device id so both PEP trees name
    // the same device, matching what multi-profile clients publish
    const legacy = await OmemoManager.create({
      namespace: 'legacy',
      store: stores.legacy,
      ownJid,
      deviceId: omemo2.deviceId
    })
    const result: InitResult = {
      deviceId: omemo2.deviceId,
      secure: stores.secure,
      ...(stores.keyWrapError !== undefined
        ? {
            keyWrapError:
              stores.keyWrapError instanceof Error
                ? stores.keyWrapError.message
                : String(stores.keyWrapError)
          }
        : {})
    }
    state = {
      managers: { omemo2, legacy },
      stores: { omemo2: stores.omemo2, legacy: stores.legacy },
      meta: stores.meta,
      init: result
    }
    return result
  }

  async function dispatch(request: CryptoRequest): Promise<unknown> {
    const { op, args } = request
    if (op === 'init') return init(args)
    const s = state
    if (s === undefined) throw new Error('omemo worker used before init')
    const ns = args.ns ?? 'omemo2'
    switch (op) {
      case 'encrypt':
        if (args.input === undefined) throw new Error('encrypt requires input')
        return s.managers[ns].encrypt(args.input)
      case 'decrypt':
        if (args.element === undefined || args.senderJid === undefined) {
          throw new Error('decrypt requires element and senderJid')
        }
        return s.managers[ns].decrypt(args.element, args.senderJid)
      case 'buildBundle':
        return s.managers[ns].buildBundle()
      case 'parseBundle':
        if (args.element === undefined) throw new Error('parseBundle requires element')
        return s.managers[ns].parseBundle(args.element)
      case 'identityKey':
        // only the public wire key crosses back. Private bytes stay
        return (await s.stores[ns].getIdentity())?.wirePublicKey ?? null
      case 'getDeviceIds':
        return (await s.stores[ns].getDeviceIds(args.jid ?? '')) ?? null
      case 'putDeviceIds':
        return s.stores[ns].putDeviceIds(args.jid ?? '', args.ids ?? [])
      case 'maintain':
        return maintainKeys({
          store: s.stores[ns],
          manager: s.managers[ns],
          meta: s.meta,
          metaKey: ns
        }).then(() => null)
      default:
        throw new Error(`unknown omemo op: ${String(op)}`)
    }
  }

  // strict FIFO: each request completes before the next dispatch runs.
  // The queue swallows per-request failures so one bad op cannot wedge
  // the chain
  let queue: Promise<unknown> = Promise.resolve()
  scope.onmessage = (event) => {
    const request = event.data
    queue = queue
      .then(() => dispatch(request))
      .then(
        (value) => scope.postMessage({ id: request.id, ok: true, value }),
        (error: unknown) =>
          scope.postMessage({ id: request.id, ok: false, error: packError(error) })
      )
  }
}

// auto-attach only inside a real dedicated worker. Importing this
// module on the main thread or in tests must not clobber anything
declare const DedicatedWorkerGlobalScope: (new () => object) | undefined
if (
  typeof self !== 'undefined' &&
  typeof DedicatedWorkerGlobalScope !== 'undefined' &&
  self instanceof DedicatedWorkerGlobalScope
) {
  install(self as unknown as WorkerScope)
}
