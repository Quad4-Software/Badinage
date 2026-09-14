// Builds the worker script for an extension. The prelude runs before
// any extension code in a dedicated worker realm: it strips network,
// storage and code-loading intrinsics, then installs the badinage api
// object and the RPC dispatch. The extension bundle is appended as
// plain source, not evaluated, so CSP never needs unsafe-eval.

import type { Permission } from './types'

const PRELUDE = `'use strict'
// capabilities the extension must not reach. Deleted from the global
// before extension code runs, so there is no reference left to recover
const WIPED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource',
  'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel',
  'indexedDB', 'caches', 'RTCPeerConnection', 'openDatabase',
  'FileSystemDirectoryHandle', 'FileSystemFileHandle',
  'showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker',
  'navigation', 'serviceWorker', 'cookieStore', 'locks'
]
for (const k of WIPED) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: true }) } catch (e) {}
}
try { Object.defineProperty(Navigator.prototype, 'sendBeacon', { value: undefined }) } catch (e) {}
try { Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined }) } catch (e) {}

const PERMS = __PERMS__
const handlers = new Map()
const pending = new Map()
const menuItems = []
const commands = []
let settingsFields = []
let settingsValues = {}
let settingsCb = null
let seq = 0

function post(m) { self.postMessage(m) }
function guard(p) { if (PERMS.indexOf(p) < 0) throw new Error(p + ' permission required') }
function call(method, args) {
  return new Promise(function (resolve, reject) {
    const id = ++seq
    pending.set(id, { resolve: resolve, reject: reject })
    post({ t: 'call', id: id, method: method, args: args })
  })
}

self.badinage = {
  menus: {
    add: function (section, item, handler) {
      guard('menus')
      if (typeof section !== 'string' || !item || typeof item.id !== 'string' || typeof item.label !== 'string')
        throw new Error('bad menu item')
      if (typeof handler !== 'function') throw new Error('menu item needs a handler')
      if (menuItems.length >= 10) throw new Error('menu item limit reached')
      handlers.set(item.id, handler)
      menuItems.push({ id: item.id, section: section, label: item.label.slice(0, 80), danger: item.danger === true })
      post({ t: 'menus', items: menuItems })
    }
  },
  toast: function (text) {
    guard('toast')
    call('toast', [String(text).slice(0, 200)])
  },
  storage: {
    get: function (key) {
      guard('storage')
      return call('storage.get', [String(key)]).then(function (v) {
        if (v === null || v === undefined) return null
        try { return JSON.parse(v) } catch (e) { return null }
      })
    },
    set: function (key, value) {
      guard('storage')
      const json = JSON.stringify(value === undefined ? null : value)
      if (json.length > 65536) throw new Error('storage value too large')
      return call('storage.set', [String(key), json])
    }
  },
  net: {
    fetch: function (url, init) {
      guard('net')
      return call('net.fetch', [String(url), init === undefined ? {} : init])
    }
  },
  commands: {
    add: function (command, handler) {
      guard('commands')
      if (!command || typeof command.name !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(command.name))
        throw new Error('bad command name')
      if (typeof handler !== 'function') throw new Error('command needs a handler')
      if (commands.length >= 10) throw new Error('command limit reached')
      handlers.set('cmd:' + command.name, handler)
      commands.push({ id: command.name, name: command.name, description: String(command.description || '').slice(0, 120) })
      post({ t: 'commands', items: commands })
    }
  },
  settings: {
    define: function (fields) {
      guard('settings')
      if (!Array.isArray(fields)) throw new Error('settings fields must be an array')
      settingsFields = fields.slice(0, 20)
      post({ t: 'settings', fields: settingsFields })
    },
    values: function () {
      return settingsValues
    },
    onChange: function (cb) {
      if (typeof cb !== 'function') throw new Error('onChange needs a callback')
      settingsCb = cb
    }
  },
  messages: {
    decorate: function (fn) {
      guard('messages.decorate')
      if (typeof fn !== 'function') throw new Error('decorator needs a function')
      handlers.set('decorate', fn)
      post({ t: 'decorator' })
    }
  },
  log: function () {
    call('log', Array.prototype.slice.call(arguments).map(String).join(' ').slice(0, 500))
  }
}

self.onmessage = function (e) {
  const m = e.data
  if (!m || typeof m !== 'object') return
  if (m.t === 'run') {
    const fn = handlers.get(m.itemId)
    if (!fn) { post({ t: 'fail', id: m.id, error: 'unknown item' }); return }
    Promise.resolve()
      .then(function () { return fn(m.payload) })
      .then(function (v) { post({ t: 'result', id: m.id, value: v === undefined ? null : v }) })
      .catch(function (err) { post({ t: 'fail', id: m.id, error: String((err && err.message) || err).slice(0, 300) }) })
  } else if (m.t === 'callResult' || m.t === 'callFail') {
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.t === 'callResult') p.resolve(m.value)
    else p.reject(new Error(m.error || 'api call failed'))
  } else if (m.t === 'settings') {
    settingsValues = (m.values && typeof m.values === 'object') ? m.values : {}
    if (settingsCb) {
      try { settingsCb(settingsValues) } catch (e) { post({ t: 'crash', error: String(e).slice(0, 200) }) }
    }
  }
}
`

// worker script = sandbox prelude + extension bundle + ready marker.
// The ready post sits after the bundle so a crash during top-level
// evaluation is reported instead of announcing a live extension
export function buildWorkerSource(code: string, permissions: Permission[]): string {
  return `${PRELUDE.replace('__PERMS__', JSON.stringify(permissions))}\n${code}\n;self.postMessage({ t: 'ready' })\n`
}
