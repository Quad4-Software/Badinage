import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // the interop suite drives a persistent python bridge; give it headroom
    // on loaded machines
    testTimeout: 30_000
  }
})
