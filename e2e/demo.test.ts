import { expect, test } from '@playwright/test'

test('demo mode signs in without a server', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByRole('button', { name: 'demo@badinage.local' })).toBeVisible({
    timeout: 10_000
  })
})

test('demo mode shows contacts, rooms and a subscription request', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByText('Aria').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /lobby/ }).first()).toBeVisible()
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
  const input = page.getByLabel(/Message Aria/)
  await input.fill('hello from the test')
  await input.press('Enter')
  await expect(page.locator('ol').getByText('hello from the test')).toBeVisible()
})

test('demo mode opens the room and shows its subject', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const room = page.getByRole('button', { name: /lobby/ }).first()
  await expect(room).toBeVisible({ timeout: 10_000 })
  await room.click()
  await expect(page.getByText('Badinage lobby: be nice').first()).toBeVisible()
})

test('sidebar search filters conversations', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByRole('button', { name: /Aria/ }).first()).toBeVisible({ timeout: 10_000 })
  // the sidebar search field opens the command palette; the palette
  // combobox does the filtering
  await page.getByRole('button', { name: 'Search conversations and contacts' }).click()
  const palette = page.getByRole('dialog')
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('cleo')
  await expect(palette.getByRole('option', { name: /Aria/ })).toHaveCount(0)
  await expect(palette.getByRole('option', { name: /Cleo/ }).first()).toBeVisible()
  await palette.getByRole('combobox').fill('')
  await expect(palette.getByRole('option', { name: /Aria/ }).first()).toBeVisible()
})

test('unread badges are circular', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const badge = page.locator('[aria-label$="unread"]').first()
  await expect(badge).toBeVisible({ timeout: 10_000 })
  const box = await badge.boundingBox()
  if (!box) throw new Error('badge has no bounding box')
  expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1)
})

test('scrolling to top loads an older archive page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const conversation = page.getByRole('button', { name: /Aria/ }).first()
  await expect(conversation).toBeVisible({ timeout: 10_000 })
  await conversation.click()
  const before = await page.locator('ol li').count()
  // the pager button only renders near the top; the list opens pinned to
  // the bottom, so scroll the scrollable ancestor to zero first
  await page.locator('ol').evaluate((el) => {
    let p = el.parentElement
    while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement
    if (p) p.scrollTop = 0
  })
  const loadOlder = page.getByRole('button', { name: 'Load older messages' })
  await expect(loadOlder).toBeVisible()
  await loadOlder.click()
  await expect(page.getByText('Beginning of the conversation')).toBeVisible({ timeout: 10_000 })
  expect(await page.locator('ol li').count()).toBeGreaterThan(before)
})

test('demo encrypts direct messages and shows the lock', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const conversation = page.getByRole('button', { name: /Aria/ }).first()
  await expect(conversation).toBeVisible({ timeout: 10_000 })
  await conversation.click()
  const input = page.getByLabel(/Message Aria/)
  await input.fill('secret message')
  await input.press('Enter')
  await expect(page.locator('ol').getByText('secret message')).toBeVisible()
  // the outgoing bubble and the demo reply both carry the encrypted flag
  await expect(page.locator('[aria-label="Encrypted"]').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByLabel('End-to-end encrypted')).toBeVisible()
})

test('demo settings show the encryption section with fingerprints', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  await expect(page.getByRole('button', { name: 'demo@badinage.local' })).toBeVisible({
    timeout: 10_000
  })
  await page.keyboard.press('Control+,')
  const dialog = page.getByRole('dialog')
  // the side nav only exists on desktop; the section is always mounted
  await expect(dialog.getByText('Your device fingerprint')).toBeVisible()
  await expect(dialog.getByLabel('Blindly trust new devices')).toBeVisible()
  // contacts publish real omemo devices in demo mode
  await dialog.getByRole('button', { name: /Aria/ }).click()
  await expect(dialog.getByRole('button', { name: 'Verify' }).first()).toBeVisible({
    timeout: 10_000
  })
  await expect(dialog.getByText('Blindly trusted').first()).toBeVisible()
})

test('composer placeholder uses the contact name', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const conversation = page.getByRole('button', { name: /Aria/ }).first()
  await expect(conversation).toBeVisible({ timeout: 10_000 })
  await conversation.click()
  await expect(page.getByLabel(/Message Aria/)).toBeVisible()
})
