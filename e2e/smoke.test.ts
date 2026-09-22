import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('login screen renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Badinage' })).toBeVisible()
  await expect(page.getByLabel('Address or nickname')).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
})

test('login screen has no detectable axe violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('login form validates the jid', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Address or nickname').fill('not-a-jid')
  await page.getByLabel('Password', { exact: true }).fill('secret')
  await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled()
})

test('anonymous mode swaps the jid for a bare domain', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Sign in anonymously').check()
  // password is gone and the field wants a domain-only value
  await expect(page.getByLabel('Password', { exact: true })).toBeHidden()
  await expect(page.getByLabel('Server domain')).toBeVisible()
  await page.getByLabel('Server domain').fill('anon.localhost')
  await expect(page.getByRole('button', { name: 'Connect' })).toBeEnabled()
  // a full jid is not a valid anonymous domain
  await page.getByLabel('Server domain').fill('me@anon.localhost')
  await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled()
})
