/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// deploys under a subpath (github pages project sites) set VITE_BASE;
// a demo-only deployment sets VITE_DEMO=1 to land straight in demo mode
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    tailwindcss(),
    svelte(),
    VitePWA({
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
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`
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
        // entry chunk under the size warning and lets them cache separately
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('strophe.js')) return 'strophe'
          if (id.includes('@lucide')) return 'lucide'
        }
      }
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
