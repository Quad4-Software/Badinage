/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: path.resolve(dirname, 'src/lib')
    }
  },
  build: {
    target: 'es2022',
    sourcemap: true
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
