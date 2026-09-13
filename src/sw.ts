/// <reference lib="webworker" />
// Dependency-free service worker bundled by vite-plugin-pwa in
// injectManifest mode: self.__WB_MANIFEST below is the injection point
// the build replaces with the precache manifest. Handles precaching,
// a network-first navigation fallback and the share_target POST
// endpoint, which parks the payload in IndexedDB and redirects back
// to the app.
import { SHARE_INBOX_MAX_BYTES, SHARE_TARGET_PATH } from '$lib/constants'
import { saveShare } from '$lib/core/storage/share'

declare const self: ServiceWorkerGlobalScope

declare global {
  interface ServiceWorkerGlobalScope {
    __WB_MANIFEST: { url: string; revision: string | null }[]
  }
}

const PRECACHE_PREFIX = 'badinage-precache-'

// light checksum over the manifest so every build lands in a fresh
// cache and activate can sweep the previous one
function checksum(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

const manifest = self.__WB_MANIFEST
const PRECACHE = `${PRECACHE_PREFIX}${checksum(
  manifest.map((entry) => `${entry.url}@${entry.revision ?? ''}`).join('\n')
)}`

// manifest urls are relative to the registration scope; resolved to
// absolute urls so request.url can be looked up directly
const precached = new Set(manifest.map((entry) => new URL(entry.url, self.registration.scope).href))
const indexUrl = new URL('index.html', self.registration.scope).href
const homeUrl = new URL('./', self.registration.scope).href
const scopePath = new URL(self.registration.scope).pathname

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll([...precached]))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(PRECACHE_PREFIX) && name !== PRECACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method === 'POST' && isShareTarget(new URL(event.request.url))) {
    event.respondWith(shareResponse(event.request))
    return
  }
  if (event.request.method !== 'GET') return
  if (event.request.mode === 'navigate') {
    event.respondWith(navigationResponse(event.request))
    return
  }
  if (precached.has(new URL(event.request.url).href)) {
    event.respondWith(cacheResponse(event.request))
  }
})

// the manifest share_target action is ./share-target resolved against
// the scope, so under a subpath deploy it is <base>/share-target
function isShareTarget(url: URL): boolean {
  return url.pathname.startsWith(scopePath) && url.pathname.endsWith(`/${SHARE_TARGET_PATH}`)
}

// park the shared form payload in IndexedDB and land the user back on
// the app, which drains the inbox on startup
async function shareResponse(request: Request): Promise<Response> {
  try {
    const form = await request.formData()
    const text = (name: string): string => {
      const value = form.get(name)
      return typeof value === 'string' ? value : ''
    }
    // a blank file input arrives as a nameless zero-byte File
    const files = form
      .getAll('files')
      .filter((entry): entry is File => entry instanceof File && entry.name !== '')
    const bytes = files.reduce((total, file) => total + file.size, 0)
    await saveShare({
      // over the cap: keep the text fields, drop the files
      files: bytes > SHARE_INBOX_MAX_BYTES ? [] : files,
      title: text('title'),
      text: text('text'),
      url: text('url'),
      at: Date.now()
    })
  } catch {
    // a malformed body or an idb failure must not strand the user:
    // land on the app either way
  }
  return Response.redirect(homeUrl, 303)
}

// navigations are network-first so deploys take effect immediately,
// with the precached index as the offline fallback
async function navigationResponse(request: Request): Promise<Response> {
  try {
    return await fetch(request)
  } catch (error) {
    const cached = await caches.match(indexUrl)
    if (cached) return cached
    throw error
  }
}

async function cacheResponse(request: Request): Promise<Response> {
  const cache = await caches.open(PRECACHE)
  return (await cache.match(request)) ?? fetch(request)
}
