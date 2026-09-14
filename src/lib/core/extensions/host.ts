// Host side of an extension worker. Owns the Worker object, the RPC
// bookkeeping and the error budget that drives auto-disable. Every
// message off the wire is shape-checked before it is trusted.

import {
  EXT_LIMITS,
  type ExtCommand,
  type ExtMenuItem,
  type ExtSettingField,
  type Permission
} from './types'
import { parseCommands, parseMenuItems, parseSettingsFields } from './wire'
import { buildWorkerSource } from './worker-source'

export interface HostHandlers {
  onReady?(): void
  onMenus(items: ExtMenuItem[]): void
  onCommands?(items: ExtCommand[]): void
  onSettings?(fields: ExtSettingField[]): void
  // the worker registered a message decorator
  onDecorator?(): void
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
  resolve?: (value: unknown) => void
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
    void this.invokeValue(itemId, payload)
  }

  // run a handler and resolve with its return value. Used by commands
  // and decorators where the answer matters. Null on timeout or an
  // unready worker, failures still feed the error budget
  invokeValue(itemId: string, payload: unknown): Promise<unknown> {
    const worker = this.worker
    if (!worker || !this.ready) return Promise.resolve(null)
    const id = ++this.seq
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.noteError(`handler timed out: ${itemId}`)
        resolve(null)
      }, EXT_LIMITS.callTimeoutMs)
      this.pending.set(id, { timer, resolve })
      worker.postMessage({ t: 'run', id, itemId, payload })
    })
  }

  // push the persisted settings values into the worker. Sent once the
  // worker is ready and again on every host-side change
  pushSettings(values: Record<string, unknown>): void {
    this.worker?.postMessage({ t: 'settings', values })
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
        this.h.onMenus(parseMenuItems((m as { items?: unknown }).items))
        return
      case 'commands':
        if (this.permissions.includes('commands')) {
          this.h.onCommands?.(parseCommands((m as { items?: unknown }).items))
        }
        return
      case 'settings':
        if (this.permissions.includes('settings')) {
          this.h.onSettings?.(parseSettingsFields((m as { fields?: unknown }).fields))
        }
        return
      case 'decorator':
        if (this.permissions.includes('messages.decorate')) this.h.onDecorator?.()
        return
      case 'result':
      case 'fail': {
        if (typeof m.id !== 'number') return
        const p = this.pending.get(m.id)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(m.id)
        if (m.t === 'fail') {
          this.noteError(str((m as { error?: unknown }).error, 300))
          p.resolve?.(null)
        } else {
          p.resolve?.((m as { value?: unknown }).value ?? null)
        }
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
