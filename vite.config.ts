/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// deploys under a subpath (github pages project sites) set VITE_BASE
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    tailwindcss(),
    svelte(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Badinage',
        short_name: 'Badinage',
        description: 'Self-hostable web XMPP client',
        theme_color: '#18181b',
        background_color: '#18181b',
        display: 'standalone',
        // relative paths so the manifest works under a subpath deploy
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        // OS-level web+xmpp: links land on ?uri=; the app parses them
        // through parseDeepLink in lib/state/deeplink.ts
        protocol_handlers: [{ protocol: 'web+xmpp', url: './?uri=%s' }],
        // POSTs here are answered by the service worker, which parks
        // the payload in IndexedDB and redirects back to the app
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'files', accept: ['*/*'] }]
          }
        }
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}']
      }
    })
  ],
  resolve: {
    alias: {
      $lib: path.resolve(dirname, 'src/lib')
    }
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // strophe and lucide are heavy leaf deps; splitting them keeps the
        // entry chunk under the size warning and lets them cache separately.
        // sentry gets its own chunk so the opt-in lazy import cannot be
        // dragged back into the entry graph by a shared runtime helper
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('strophe.js')) return 'strophe'
          if (id.includes('@lucide')) return 'lucide'
          if (id.includes('@sentry')) return 'sentry'
        }
      }
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
      include: ['src/lib/core/**', 'src/lib/state/**', 'src/lib/utils/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.bench.ts',
        'src/lib/core/xmpp/demo.ts',
        'src/lib/core/xmpp/demo-data.ts',
        'src/lib/i18n/**',
        'src/lib/ui/**'
      ],
      thresholds: {
        lines: 60,
        statements: 58,
        branches: 55,
        functions: 45
      }
    },
    benchmark: {
      suppressExportGetterWarnings: true
    }
  }
})
