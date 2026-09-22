import { expect, type Page } from '@playwright/test'

// Signs into the bundled demo account and waits for the shell. The
// connect toast is dismissed when it appears so axe sweeps and clicks
// see the steady state, not a fading overlay.
export async function enterDemo(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByRole('button', { name: 'demo@badinage.local' })).toBeVisible({
    timeout: 10_000
  })
  const toast = page.locator('[data-sonner-toast]')
  await toast
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => undefined)
  if (await toast.count()) {
    await page.getByRole('button', { name: 'Close toast' }).first().click()
    await expect(toast).toHaveCount(0, { timeout: 10_000 })
  }
}
