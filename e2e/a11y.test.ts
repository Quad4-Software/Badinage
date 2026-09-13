import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function enterDemo(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByRole('button', { name: 'demo@badinage.local' })).toBeVisible({
    timeout: 10_000
  })
  // close the connect toast if it is up so the sweep covers the steady
  // state and not a fading or backdrop-dimmed toast
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

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
}

test('demo shell has no detectable axe violations', async ({ page }) => {
  await enterDemo(page)
  await expect(page.getByRole('button', { name: /Aria/ }).first()).toBeVisible()
  await expectNoViolations(page)
})

test('open conversation has no detectable axe violations', async ({ page }) => {
  await enterDemo(page)
  const conversation = page.getByRole('button', { name: /Aria/ }).first()
  await expect(conversation).toBeVisible()
  await conversation.click()
  await expect(page.locator('ol li').first()).toBeVisible()
  await expectNoViolations(page)
})

test('room view with occupants has no detectable axe violations', async ({ page }) => {
  await enterDemo(page)
  const room = page.getByRole('button', { name: /lobby/ }).first()
  await expect(room).toBeVisible()
  await room.click()
  const occupants = page.getByRole('button', { name: /occupants/ })
  await expect(occupants).toBeVisible()
  await occupants.click()
  // the occupant panel only renders on md and up (hidden md:block)
  const desktop = await page.evaluate(() => window.matchMedia('(min-width: 768px)').matches)
  if (desktop) {
    await expect(page.getByLabel('Search members')).toBeVisible()
  }
  await expectNoViolations(page)
})

test('settings dialog has no detectable axe violations', async ({ page }) => {
  await enterDemo(page)
  await page.getByRole('button', { name: 'Open settings' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expectNoViolations(page)
})

test('add contact dialog has no detectable axe violations', async ({ page }) => {
  await enterDemo(page)
  await page.getByRole('button', { name: 'Add a contact' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expectNoViolations(page)
})

test('join room dialog has no detectable axe violations', async ({ page }) => {
  await enterDemo(page)
  await page.getByRole('button', { name: 'Join a room' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expectNoViolations(page)
})

test('command palette with a message search has no detectable axe violations', async ({ page }) => {
  await enterDemo(page)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // a query long enough to engage message-body matching
  await page.keyboard.type('aria')
  await expectNoViolations(page)
})
