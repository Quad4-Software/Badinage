// Showcase screenshots: builds the app, serves the preview, opens demo mode
// and captures docs/screenshot.png (light) + docs/screenshot-dark.png for the
// README. Run with `pnpm screenshot`.
// Needs `pnpm exec playwright install chromium` once.

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const PORT = 4874
const BASE = `http://localhost:${PORT}`
const docsDir = new URL('../docs', import.meta.url).pathname

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

async function shoot(browser, { dark }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  if (dark) {
    // mode-watcher persists the choice in localStorage
    await page.addInitScript(() => {
      localStorage.setItem('mode-watcher-mode', 'dark')
    })
  }
  await page.goto(BASE)

  await page.getByRole('button', { name: 'Try the demo' }).click()

  // wait for the seeded lobby room to appear, then open it for the shot
  await page.getByRole('button', { name: /lobby/ }).first().waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: /lobby/ }).first().click()

  // let history + delayed fake messages/reactions land
  await page.waitForTimeout(6000)

  const file = `${docsDir}/screenshot${dark ? '-dark' : ''}.png`
  await page.screenshot({ path: file })
  await page.close()
  console.log(`screenshot written to ${file}`)
}

const server = spawn('pnpm', ['preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore'
})

try {
  await waitForServer(BASE)
  await mkdir(docsDir, { recursive: true })

  const browser = await chromium.launch()
  await shoot(browser, { dark: false })
  await shoot(browser, { dark: true })
  await browser.close()
} finally {
  server.kill()
}
