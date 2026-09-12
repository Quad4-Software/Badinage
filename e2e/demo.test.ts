import { expect, test } from '@playwright/test'

test('demo mode signs in without a server', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByText('demo@badinage.local')).toBeVisible({ timeout: 10_000 })
})

test('demo mode shows contacts, rooms and a subscription request', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByText('aria@badinage.local').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('lobby@conference.badinage.local').first()).toBeVisible()
  await expect(page.getByText('wren@badinage.local wants to see your presence')).toBeVisible({
    timeout: 10_000
  })
})

test('demo mode opens a conversation and sends a message', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const conversation = page.getByRole('button', { name: /Aria/ }).first()
  await expect(conversation).toBeVisible({ timeout: 10_000 })
  await conversation.click()
  const input = page.getByLabel(/Message aria@badinage.local/)
  await input.fill('hello from the test')
  await input.press('Enter')
  await expect(page.locator('ol').getByText('hello from the test')).toBeVisible()
})

test('demo mode opens the room and shows its subject', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const room = page.getByRole('button', { name: /lobby@conference/ }).first()
  await expect(room).toBeVisible({ timeout: 10_000 })
  await room.click()
  await expect(page.getByText('Badinage lobby: be nice')).toBeVisible()
})
