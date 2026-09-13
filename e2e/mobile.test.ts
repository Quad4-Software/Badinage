import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test('contextmenu or long-press opens the message action sheet', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const conversation = page.getByRole('button', { name: /Aria/ }).first()
  await expect(conversation).toBeVisible({ timeout: 10_000 })
  await conversation.click()

  const input = page.getByLabel(/Message Aria/)
  await input.fill('hello mobile')
  await input.press('Enter')
  const bubble = page.locator('ol').getByText('hello mobile')
  await expect(bubble).toBeVisible()

  // right click stands in for the touch hold; both take the same path
  await bubble.dispatchEvent('contextmenu')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Reply' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Copy message text' })).toBeVisible()

  // a quick reaction from the sheet lands as a pill on the message
  await sheet.getByRole('button', { name: 'Add reaction' }).first().click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('ol').getByRole('button', { name: /👍/ })).toBeVisible()
})

test('a hold gesture without a contextmenu still opens the sheet', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const conversation = page.getByRole('button', { name: /Aria/ }).first()
  await expect(conversation).toBeVisible({ timeout: 10_000 })
  await conversation.click()
  await expect(page.getByLabel(/Message Aria/)).toBeVisible()

  const bubble = page.locator('ol .msg-bubble').first()
  await expect(bubble).toBeVisible()
  await bubble.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    clientX: 100,
    clientY: 100
  })
  await page.waitForTimeout(600)
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('composer exposes a send key hint and the attach sheet', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Try the demo' }).click()
  const conversation = page.getByRole('button', { name: /Aria/ }).first()
  await expect(conversation).toBeVisible({ timeout: 10_000 })
  await conversation.click()

  const input = page.getByLabel(/Message Aria/)
  await expect(input).toHaveAttribute('enterkeyhint', 'send')

  await page.getByRole('button', { name: 'Attach file' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Attach image' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Attach video' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Attach file' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Share location' })).toBeVisible()
})
