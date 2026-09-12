// Showcase screenshot: builds the app, serves the preview, opens demo mode and
// captures docs/screenshot.png for the README. Run with `pnpm screenshot`.
// Needs `pnpm exec playwright install chromium` once.

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const PORT = 4874
const BASE = `http://localhost:${PORT}`
const OUT = new URL('../docs/screenshot.png', import.meta.url).pathname

function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await fetch(url)
        if (res.ok) return resolve()
      } catch {
        // server not up yet
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('preview server timed out'))
      setTimeout(poll, 300)
    }
    void poll()
  })
}

const server = spawn('pnpm', ['preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore'
})

try {
  await waitForServer(BASE)
  await mkdir(new URL('../docs', import.meta.url).pathname, { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(BASE)

  await page.getByRole('button', { name: 'Try the demo' }).click()

  // wait for the seeded lobby room to appear, then open it for the shot
  await page.getByText('lobby@conference.badinage.local').first().waitFor({ timeout: 10_000 })
  await page.getByText('lobby@conference.badinage.local').first().click()

  // let history + the delayed fake message land
  await page.waitForTimeout(4000)

  await page.screenshot({ path: OUT })
  await browser.close()
  console.log(`screenshot written to ${OUT}`)
} finally {
  server.kill()
}
