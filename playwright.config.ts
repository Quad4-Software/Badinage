import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4873',
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    // VITE_E2E skips the automatic one-time prompt queue so specs are
    // not blocked by the consent modal; prompts.svelte.ts exposes a
    // window hook for the prompt spec to drive it directly.
    // VITE_SENTRY_DSN=off keeps the build hermetic: opting in through
    // the prompt never initializes the SDK or hits a real endpoint
    command: 'VITE_E2E=1 VITE_SENTRY_DSN=off pnpm build && pnpm preview --port 4873 --strictPort',
    url: 'http://localhost:4873',
    reuseExistingServer: false
  }
})
