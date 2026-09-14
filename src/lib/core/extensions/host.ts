// Host side of an extension worker. Owns the Worker object, the RPC
// bookkeeping and the error budget that drives auto-disable. Every
// message off the wire is shape-checked before it is trusted.

import { EXT_LIMITS, type ExtMenuItem, type Permission } from './types'
import { buildWorkerSource } from './worker-source'

export interface HostHandlers {
  onReady?(): void
  onMenus(items: ExtMenuItem[]): void
  // api surface the worker can call. Handlers enforce permissions
  // themselves, the host just routes
  onToast(text: string): void
  onStorageGet(key: string): Promise<unknown>
  onStorageSet(key: string, value: string): Promise<void>
  onNetFetch(url: string, init: Record<string, unknown>): Promise<string>
  onLog(text: string): void
  // counted errors and the limit trip that asks the store to disable
  onError(message: string): void
  onErrorLimit(): void
}

interface Pending {
  timer: ReturnType<typeof setTimeout>
}

interface Wire {
  t?: unknown
  id?: unknown
}

function str(v: unknown, max: number): string {
  return String(v).slice(0, max)
}

export class ExtensionHost {
  errors = 0
  ready = false

  private worker: Worker | null = null
  private url = ''
  private seq = 0
  private pending = new Map<number, Pending>()
  private readyTimer: ReturnType<typeof setTimeout>

  constructor(
    code: string,
    private permissions: Permission[],
    private h: HostHandlers
  ) {
    const blob = new Blob([buildWorkerSource(code, permissions)], { type: 'text/javascript' })
    this.url = URL.createObjectURL(blob)
    this.worker = new Worker(this.url)
    this.worker.onmessage = (e) => this.onMessage(e.data)
    this.worker.onerror = (e) => this.noteError(`crash: ${str(e.message, 200)}`)
    this.worker.onmessageerror = () => this.noteError('unserializable message from worker')
    // a worker that never posts ready is either crashed or looping.
    // Either way it must not run on
    this.readyTimer = setTimeout(() => {
      if (!this.ready) {
        this.noteError('worker did not start')
        this.kill()
      }
    }, EXT_LIMITS.readyTimeoutMs)
  }

  // run a menu item inside the worker. The result is ignored, failures
  // feed the error budget
  invoke(itemId: string, payload: unknown): void {
    const worker = this.worker
    if (!worker || !this.ready) return
    const id = ++this.seq
    const timer = setTimeout(() => {
      this.pending.delete(id)
      this.noteError(`menu item timed out: ${itemId}`)
    }, EXT_LIMITS.callTimeoutMs)
    this.pending.set(id, { timer })
    worker.postMessage({ t: 'run', id, itemId, payload })
  }

  private noteError(message: string): void {
    this.errors += 1
    this.h.onError(message)
    if (this.errors >= EXT_LIMITS.errorLimit) this.h.onErrorLimit()
  }

  private onMessage(data: unknown): void {
    const m = data as Wire
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return
    switch (m.t) {
      case 'ready':
        this.ready = true
        clearTimeout(this.readyTimer)
        this.h.onReady?.()
        return
      case 'menus':
        if (Array.isArray((m as { items?: unknown }).items)) {
          const items = (m as { items: unknown[] }).items
            .filter(
              (i): i is ExtMenuItem =>
                typeof i === 'object' &&
                i !== null &&
                typeof (i as ExtMenuItem).id === 'string' &&
                typeof (i as ExtMenuItem).section === 'string' &&
                typeof (i as ExtMenuItem).label === 'string'
            )
            .slice(0, EXT_LIMITS.menuItemsMax)
          this.h.onMenus(items)
        }
        return
      case 'result':
      case 'fail': {
        if (typeof m.id !== 'number') return
        const p = this.pending.get(m.id)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(m.id)
        if (m.t === 'fail') this.noteError(str((m as { error?: unknown }).error, 300))
        return
      }
      case 'call':
        void this.handleCall(m)
        return
      case 'crash':
        this.noteError(str((m as { error?: unknown }).error, 200))
        return
    }
  }

  private async handleCall(m: Wire): Promise<void> {
    if (typeof m.id !== 'number') return
    const id = m.id
    const method = (m as { method?: unknown }).method
    const args = (m as { args?: unknown }).args
    const reply = (t: string, extra: Record<string, unknown>) =>
      this.worker?.postMessage({ t, id, ...extra })
    try {
      if (method === 'toast' && this.permissions.includes('toast')) {
        this.h.onToast(str((args as unknown[])?.[0], 200))
        reply('callResult', { value: null })
      } else if (method === 'storage.get' && this.permissions.includes('storage')) {
        reply('callResult', {
          value: await this.h.onStorageGet(str((args as unknown[])?.[0], 200))
        })
      } else if (method === 'storage.set' && this.permissions.includes('storage')) {
        const value = str((args as unknown[])?.[1], EXT_LIMITS.storageValueMaxBytes)
        await this.h.onStorageSet(str((args as unknown[])?.[0], 200), value)
        reply('callResult', { value: null })
      } else if (method === 'net.fetch' && this.permissions.includes('net')) {
        const url = str((args as unknown[])?.[0], 2000)
        const init = ((args as unknown[])?.[1] ?? {}) as Record<string, unknown>
        reply('callResult', { value: await this.h.onNetFetch(url, init) })
      } else if (method === 'log') {
        this.h.onLog(str((args as unknown[])?.[0], 500))
        reply('callResult', { value: null })
      } else {
        reply('callFail', { error: 'unknown or unpermitted call' })
      }
    } catch (err) {
      reply('callFail', { error: str((err as Error)?.message ?? err, 300) })
    }
  }

  kill(): void {
    clearTimeout(this.readyTimer)
    for (const p of this.pending.values()) clearTimeout(p.timer)
    this.pending.clear()
    this.worker?.terminate()
    this.worker = null
    if (this.url) URL.revokeObjectURL(this.url)
    this.ready = false
  }
}
