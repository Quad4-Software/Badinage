import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('login screen renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Badinage' })).toBeVisible()
  await expect(page.getByLabel('XMPP address')).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
})

test('login screen has no detectable axe violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('login form validates the jid', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('XMPP address').fill('not-a-jid')
  await page.getByLabel('Password', { exact: true }).fill('secret')
  await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled()
})
