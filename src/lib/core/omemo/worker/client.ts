// WorkerOmemoCrypto: the main-thread client for the OMEMO worker.
//
// Lifecycle and race rules:
// - one init handshake per worker. Calls made while the handshake is
//   in flight queue behind the same promise
// - every call carries an id. Replies for unknown ids are dropped, so a
//   late message from a killed worker can never resolve a new request
// - a worker error or a call timeout kills the worker and rejects every
//   pending call. A timed-out call may have half-mutated ratchet state,
//   so the worker is not trusted to continue
// - the next call after a kill lazily respawns a fresh worker over the
//   same IndexedDB stores. dispose() is the only permanent stop
// - worker-side dispatch is a strict FIFO, so concurrent calls can
//   never interleave ratchet mutations

import type {
  DecryptResult,
  EncryptInput,
  Namespace,
  ParsedBundle,
  XmlElement
} from '@quad4-software/badinage-omemo'

import type { OmemoCrypto, OmemoCryptoOptions } from './crypto'
import { OMEMO_CALL_TIMEOUT_MS, unpackError } from './protocol'
import type { CryptoArgs, CryptoOp, CryptoRequest, CryptoResponse, InitResult } from './protocol'

// the slice of Worker the client needs, so tests can substitute a fake
export interface WorkerLike {
  postMessage(request: CryptoRequest): void
  addEventListener(type: 'message', listener: (event: { data: CryptoResponse }) => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
  terminate(): void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class WorkerCryptoDownError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerCryptoDownError'
  }
}

export class WorkerOmemoCrypto implements OmemoCrypto {
  deviceId = 0
  secure = false
  keyWrapError: unknown

  private worker: WorkerLike | undefined
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private starting: Promise<void> | undefined
  // crashed or timed out: the next call respawns
  private dead = false
  // dispose() called: never respawn, every call rejects
  private disposed = false
  // bumped per worker so a replaced worker's events cannot reach the
  // new one's pending map
  private generation = 0
  // test hook: counts workers killed by crash or timeout
  readonly stats = { killed: 0, respawns: 0 }

  constructor(
    private readonly options: OmemoCryptoOptions,
    private readonly spawn: () => WorkerLike = () =>
      new Worker(new URL('./entry.ts', import.meta.url), {
        type: 'module',
        name: 'badinage-omemo'
      }) as WorkerLike,
    private readonly timeoutMs = OMEMO_CALL_TIMEOUT_MS
  ) {}

  static async create(options: OmemoCryptoOptions): Promise<WorkerOmemoCrypto> {
    const crypto = new WorkerOmemoCrypto(options)
    await crypto.ready()
    return crypto
  }

  private ready(): Promise<void> {
    this.starting ??= this.start().catch((error: unknown) => {
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  private async start(): Promise<void> {
    const worker = this.spawn()
    const generation = ++this.generation
    worker.addEventListener('message', (event) => this.onMessage(generation, event.data))
    worker.addEventListener('error', (event) => {
      this.kill(generation, new WorkerCryptoDownError('omemo worker crashed'), event)
    })
    this.worker = worker
    this.dead = false
    const result = await this.invoke<InitResult>('init', {
      accountJid: this.options.accountJid,
      ownJid: this.options.ownJid
    })
    // a kill during the handshake leaves us ready-looking but dead:
    // the invoke above already rejected, so this only runs when alive
    this.deviceId = result.deviceId
    this.secure = result.secure
    this.keyWrapError = result.keyWrapError
  }

  private onMessage(generation: number, response: CryptoResponse): void {
    // a killed or replaced worker must never resolve new requests
    if (generation !== this.generation) return
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response.value)
    else pending.reject(unpackError(response.error))
  }

  // kill the current worker and reject everything in flight. After a
  // crash the next call respawns. After dispose() nothing does
  private kill(generation: number, error: Error, event?: unknown): void {
    if (generation !== this.generation) return
    if (event !== undefined) {
      console.warn('omemo: crypto worker failed:', event instanceof Error ? event.message : event)
    }
    this.stats.killed += 1
    this.dead = true
    this.starting = undefined
    const worker = this.worker
    this.worker = undefined
    worker?.terminate()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private invoke<T>(op: CryptoOp, args: CryptoArgs): Promise<T> {
    const worker = this.worker
    if (worker === undefined || this.dead || this.disposed) {
      return Promise.reject(new WorkerCryptoDownError('omemo crypto worker is down'))
    }
    const id = this.nextId++
    const generation = this.generation
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.kill(generation, new WorkerCryptoDownError(`omemo ${op} timed out`))
        reject(new WorkerCryptoDownError(`omemo ${op} timed out`))
      }, this.timeoutMs)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      })
      try {
        worker.postMessage({ id, op, args })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private async call<T>(op: CryptoOp, args: CryptoArgs): Promise<T> {
    if (this.disposed) throw new WorkerCryptoDownError('omemo crypto disposed')
    if (this.dead) {
      // respawn over the same IndexedDB stores. Sessions, prekeys and
      // the identity all persist, so a fresh worker continues cleanly
      this.stats.respawns += 1
      this.starting = undefined
    }
    await this.ready()
    return this.invoke<T>(op, args)
  }

  encrypt(ns: Namespace, input: EncryptInput): Promise<XmlElement> {
    return this.call('encrypt', { ns, input })
  }

  decrypt(ns: Namespace, element: XmlElement, senderJid: string): Promise<DecryptResult> {
    return this.call('decrypt', { ns, element, senderJid })
  }

  buildBundle(ns: Namespace): Promise<XmlElement> {
    return this.call('buildBundle', { ns })
  }

  parseBundle(ns: Namespace, element: XmlElement): Promise<ParsedBundle> {
    return this.call('parseBundle', { ns, element })
  }

  async identityKey(ns: Namespace): Promise<Uint8Array | undefined> {
    return (await this.call<Uint8Array | null>('identityKey', { ns })) ?? undefined
  }

  async getDeviceIds(ns: Namespace, jid: string): Promise<number[] | undefined> {
    return (await this.call<number[] | null>('getDeviceIds', { ns, jid })) ?? undefined
  }

  async putDeviceIds(ns: Namespace, jid: string, ids: number[]): Promise<void> {
    await this.call('putDeviceIds', { ns, jid, ids })
  }

  async maintain(ns: Namespace): Promise<void> {
    await this.call('maintain', { ns })
  }

  dispose(): void {
    this.disposed = true
    this.kill(this.generation, new WorkerCryptoDownError('omemo crypto disposed'))
    this.dead = true
  }
}
