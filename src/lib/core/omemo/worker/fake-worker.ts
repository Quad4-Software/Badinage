// Test fixture: a stand-in Worker that pairs the real
// WorkerOmemoCrypto client with the real install() dispatch loop. The
// wire protocol, FIFO serialization, error mapping and lifecycle all
// run for real. Only postMessage and IndexedDB are faked. In-memory
// stores stand in for the persistence backend like the service tests.

import { MemoryKeyMetaStore } from '../rotation'

import { install } from './entry'
import type { BackendFactory } from './entry'
import type { CryptoRequest, CryptoResponse, WorkerScope } from './protocol'

import { InMemoryOmemoStore } from '@quad4-software/badinage-omemo'
import type { ParsedBundle, XmlElement } from '@quad4-software/badinage-omemo'

import { WorkerOmemoCrypto } from './client'
import type { WorkerLike } from './client'

// one shared backend per account so a respawned worker continues over
// the same stores, mirroring IndexedDB persistence
export function accountBackend(): BackendFactory {
  const omemo2 = new InMemoryOmemoStore()
  const legacy = new InMemoryOmemoStore()
  const meta = new MemoryKeyMetaStore()
  return () => Promise.resolve({ omemo2, legacy, meta, secure: true })
}

// postMessage feeds the installed dispatch loop, scope.postMessage
// delivers back to the client's listeners. paused simulates a wedged
// worker that never answers
export class FakeWorker implements WorkerLike {
  private readonly messageListeners: ((event: { data: CryptoResponse }) => void)[] = []
  private readonly errorListeners: ((event: unknown) => void)[] = []
  private readonly scope: WorkerScope
  readonly inbox: CryptoRequest[] = []
  terminated = false
  paused = false

  constructor(backend: BackendFactory) {
    this.scope = {
      onmessage: null,
      postMessage: (response) => this.deliver(response)
    }
    install(this.scope, backend)
  }

  postMessage(request: CryptoRequest): void {
    if (this.terminated || this.paused) return
    this.inbox.push(request)
    queueMicrotask(() => {
      if (!this.terminated) this.scope.onmessage?.({ data: request })
    })
  }

  addEventListener(
    type: 'message' | 'error',
    listener: ((event: { data: CryptoResponse }) => void) | ((event: unknown) => void)
  ): void {
    if (type === 'message') {
      this.messageListeners.push(listener as (event: { data: CryptoResponse }) => void)
    } else {
      this.errorListeners.push(listener as (event: unknown) => void)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  // test hooks: deliver a raw response (also used for stale replies)
  // and crash the worker
  deliver(response: CryptoResponse): void {
    for (const listener of this.messageListeners) listener({ data: response })
  }

  crash(event: unknown = new Error('kaboom')): void {
    for (const listener of this.errorListeners) listener(event)
  }
}

function spawnLog(backend: BackendFactory = accountBackend()): {
  workers: FakeWorker[]
  spawn: () => FakeWorker
} {
  const workers: FakeWorker[] = []
  return {
    workers,
    spawn: () => {
      const worker = new FakeWorker(backend)
      workers.push(worker)
      return worker
    }
  }
}

export async function readyCrypto(
  jid: string,
  timeoutMs = 200
): Promise<{ crypto: WorkerOmemoCrypto; workers: FakeWorker[] }> {
  const { workers, spawn } = spawnLog()
  const crypto = new WorkerOmemoCrypto({ accountJid: jid, ownJid: jid }, spawn, timeoutMs)
  await crypto.maintain('omemo2')
  return { crypto, workers }
}

// a full encrypt path: build+parse the recipient's bundle through
// THEIR worker, then encrypt for it through the sender's
export async function encryptFor(
  from: WorkerOmemoCrypto,
  to: WorkerOmemoCrypto,
  toJid: string,
  plaintext: string
): Promise<XmlElement> {
  const bundleEl = await to.buildBundle('omemo2')
  const bundle: ParsedBundle = await to.parseBundle('omemo2', bundleEl)
  return from.encrypt('omemo2', {
    recipients: [{ jid: toJid, deviceId: to.deviceId, bundle }],
    plaintext: new TextEncoder().encode(plaintext)
  })
}
