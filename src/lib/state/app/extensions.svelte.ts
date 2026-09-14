// Installed extension records, publisher trust and live worker hosts.
// Metadata persists as a small list under globalKey, bundles live in
// the IndexedDB kv store. Enabling an extension spawns a sandboxed
// worker, wires its api calls to host implementations and registers
// its menu contributions with the menu registry.

import { PersistedState } from 'runed'

import { idb } from '$lib/core/storage/idb'
import { globalKey } from '$lib/core/storage/keys'
import { ExtensionHost } from '$lib/core/extensions/host'
import { compareVersions, ManifestError, parsePackage } from '$lib/core/extensions/manifest'
import { keyFingerprint, verifyPackage } from '$lib/core/extensions/verify'
import {
  MIN_API_VERSION,
  type ExtPackage,
  type InstalledExt,
  type TrustedPublisher
} from '$lib/core/extensions/types'
import { menus } from '$lib/state/app/menus.svelte'
import { extApi } from './ext-api.svelte'
import { loadExtSettings, persistExtSetting, proxiedFetch, scrubPayload } from './ext-rpc'
import { settings } from '../settings.svelte'

const CODE_PREFIX = 'ext:code:'
const STORAGE_PREFIX = 'ext:kv:'
const MAX_NOTICE = 20

// a trust prompt the settings ui resolves. Unknown publishers and
// changed keys both require an explicit yes
interface TrustPrompt {
  publisherName: string
  fingerprint: string
  extensionName: string
  keyChanged: boolean
  resolve: (trusted: boolean) => void
}

// short-lived notices the ui drains into toasts
interface ExtNotice {
  id: number
  kind: 'info' | 'error' | 'warning'
  text: string
}

type InstallResult = { ok: true; name: string } | { ok: false; error: string }

class ExtensionsStore {
  list = $state<InstalledExt[]>([])
  publishers = $state<TrustedPublisher[]>([])
  trustPrompt = $state<TrustPrompt | null>(null)
  notices = $state<ExtNotice[]>([])

  private persisted = new PersistedState<{
    list: InstalledExt[]
    publishers: TrustedPublisher[]
  }>(globalKey('extensions'), { list: [], publishers: [] })
  private hosts = new Map<string, ExtensionHost>()
  private noticeSeq = 0
  private hydrated = false

  hydrate(): void {
    if (this.hydrated) return
    this.hydrated = true
    this.list = this.persisted.current.list
    this.publishers = this.persisted.current.publishers
    for (const ext of this.list) {
      if (ext.enabled) void this.enable(ext.id)
    }
  }

  private save(): void {
    this.persisted.current = { list: this.list, publishers: this.publishers }
  }

  private notice(kind: ExtNotice['kind'], text: string): void {
    this.notices = [...this.notices.slice(-MAX_NOTICE + 1), { id: ++this.noticeSeq, kind, text }]
  }

  drainNotice(id: number): void {
    this.notices = this.notices.filter((n) => n.id !== id)
  }

  // parse, verify and install a package file. Throws nothing, every
  // failure path returns a readable error for the settings ui
  async install(text: string, source?: string): Promise<InstallResult> {
    let pkg: ExtPackage
    try {
      pkg = parsePackage(text)
    } catch (err) {
      return { ok: false, error: err instanceof ManifestError ? err.message : 'bad package' }
    }
    const existing = this.list.find((e) => e.id === pkg.manifest.id)
    if (existing && compareVersions(pkg.manifest.version, existing.version) <= 0)
      return {
        ok: false,
        error: `version ${pkg.manifest.version} is not newer than ${existing.version}`
      }

    let fingerprint: string | undefined
    if (pkg.manifest.publisher) {
      if (!(await verifyPackage(pkg))) return { ok: false, error: 'invalid signature' }
      fingerprint = await keyFingerprint(pkg.manifest.publisher.key)
      const known = this.publishers.find((p) => p.key === pkg.manifest.publisher?.key)
      const keyChanged =
        existing?.keyFingerprint !== undefined && existing.keyFingerprint !== fingerprint
      if (!known || keyChanged) {
        const trusted = await this.askTrust({
          publisherName: pkg.manifest.publisher.name,
          fingerprint,
          extensionName: pkg.manifest.name,
          keyChanged
        })
        if (!trusted) return { ok: false, error: 'publisher not trusted' }
        if (!known)
          this.publishers = [
            // same-name records under a retired key are dropped so a
            // stale key cannot silently sign a later install
            ...this.publishers.filter((p) => p.name !== pkg.manifest.publisher?.name),
            {
              key: pkg.manifest.publisher.key,
              name: pkg.manifest.publisher.name,
              trustedAt: Date.now(),
              ...(source ? { source } : {})
            }
          ]
      }
    } else if (existing?.signed) {
      // never silently downgrade a signed install to an unsigned one
      return { ok: false, error: 'update is unsigned but the installed copy is signed' }
    } else if (!settings.current.allowUnsignedExtensions) {
      return { ok: false, error: 'unsigned extensions are disabled in settings' }
    }

    await idb.set('kv', CODE_PREFIX + pkg.manifest.id, pkg.code)
    const record: InstalledExt = {
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      api: pkg.manifest.api,
      ...(pkg.manifest.description ? { description: pkg.manifest.description } : {}),
      ...(pkg.manifest.publisher ? { publisherName: pkg.manifest.publisher.name } : {}),
      ...(fingerprint ? { keyFingerprint: fingerprint } : {}),
      signed: pkg.signature !== undefined,
      enabled: pkg.manifest.api >= MIN_API_VERSION,
      outdated: pkg.manifest.api < MIN_API_VERSION,
      errors: 0,
      permissions: pkg.manifest.permissions,
      connect: pkg.manifest.connect,
      installedAt: Date.now(),
      ...(source ? { source } : {})
    }
    this.list = [...this.list.filter((e) => e.id !== record.id), record]
    this.save()
    if (record.enabled) await this.enable(record.id)
    return { ok: true, name: record.name }
  }

  private askTrust(prompt: Omit<TrustPrompt, 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => {
      // a second install must not strand the first pending prompt
      this.trustPrompt?.resolve(false)
      this.trustPrompt = { ...prompt, resolve }
    })
  }

  resolveTrust(trusted: boolean): void {
    this.trustPrompt?.resolve(trusted)
    this.trustPrompt = null
  }

  async enable(id: string): Promise<void> {
    const ext = this.list.find((e) => e.id === id)
    if (!ext || ext.outdated) return
    this.disable(id, false)
    const code = (await idb.get<string>('kv', CODE_PREFIX + id)) ?? null
    if (code === null) {
      this.notice('error', `extension bundle missing: ${ext.name}`)
      return
    }
    const host = new ExtensionHost(code, ext.permissions, {
      onMenus: (items) => menus.setExtensionItems(id, items),
      onCommands: (items) => {
        extApi.setCommands(id, items, (itemId, payload) =>
          host.invokeValue(itemId, scrubPayload(ext, payload))
        )
      },
      onSettings: (fields) => {
        void loadExtSettings(id).then((values) => {
          extApi.setSettings(id, fields, values)
          host.pushSettings(values)
        })
      },
      onDecorator: () => {
        extApi.setDecorator(id, (itemId, payload) =>
          host.invokeValue(itemId, scrubPayload(ext, payload))
        )
      },
      onToast: (text) => this.notice('info', `${ext.name}: ${text}`),
      onStorageGet: (key) => idb.get('kv', `${STORAGE_PREFIX}${id}:${key}`),
      onStorageSet: async (key, value) => {
        await idb.set('kv', `${STORAGE_PREFIX}${id}:${key}`, value)
      },
      onNetFetch: (url, init) => proxiedFetch(ext, url, init),
      onLog: (text) => console.debug(`[ext:${id}]`, text),
      onError: (message) => {
        ext.errors += 1
        this.notice('warning', `${ext.name}: ${message}`)
      },
      onErrorLimit: () => {
        this.notice('error', `${ext.name} disabled after repeated errors`)
        this.disable(id)
      }
    })
    this.hosts.set(id, host)
    menus.registerExtension(id, (itemId, payload) => {
      host.invoke(itemId, scrubPayload(ext, payload))
    })
    extApi.registerSettingsWriter(id, (key, value) => {
      void persistExtSetting(id, key, value)
      this.hosts.get(id)?.pushSettings(extApi.settingValues.get(id) ?? {})
    })
    ext.enabled = true
    ext.errors = 0
    this.save()
  }

  disable(id: string, persist = true): void {
    this.hosts.get(id)?.kill()
    this.hosts.delete(id)
    menus.unregisterExtension(id)
    extApi.clearExtension(id)
    const ext = this.list.find((e) => e.id === id)
    if (ext) ext.enabled = false
    if (persist) this.save()
  }

  async remove(id: string): Promise<void> {
    this.disable(id, false)
    this.list = this.list.filter((e) => e.id !== id)
    await idb.del('kv', CODE_PREFIX + id)
    // purge the extension's own kv namespace too
    const prefix = `${STORAGE_PREFIX}${id}:`
    for (const key of await idb.keys('kv')) {
      if (typeof key === 'string' && key.startsWith(prefix)) await idb.del('kv', key)
    }
    this.save()
  }

  // called by the configure dialog: persist the value, update the
  // presented map and push the whole set into the worker
  setSettingValue(extId: string, key: string, value: unknown): void {
    extApi.setSettingValue(extId, key, value)
  }
}

export const extensions = new ExtensionsStore()
