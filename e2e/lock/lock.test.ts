import { expect, test, type Page } from '@playwright/test'

import { enterDemo } from '../helpers'

async function openPrivacySettings(page: Page) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Privacy', exact: true }).click()
  return dialog
}

async function unlock(page: Page, passphrase: string) {
  await page.getByLabel('Passphrase').fill(passphrase)
  await page.getByRole('button', { name: 'Unlock' }).click()
}

test.describe('app lock', () => {
  test('enable, reload to the gate, wrong then right passphrase', async ({ page }) => {
    await enterDemo(page)

    const dialog = await openPrivacySettings(page)
    await dialog.getByRole('button', { name: 'Set passphrase' }).click()
    await page.getByLabel('Passphrase', { exact: true }).fill('correct horse')
    await page.getByLabel('Confirm passphrase').fill('correct horse')
    // the submit button inside the dialog carries the same label
    await page.getByRole('dialog').last().getByRole('button', { name: 'Set passphrase' }).click()
    await expect(dialog.getByRole('button', { name: 'Lock now' })).toBeVisible()
    await page.keyboard.press('Escape')

    // a reload seals the profile and lands on the gate
    await page.reload()
    await expect(page.getByLabel('Passphrase')).toBeVisible()

    // wrong passphrase is rejected in place
    await unlock(page, 'wrong')
    await expect(page.getByText('Incorrect passphrase')).toBeVisible()

    // right passphrase unlocks back to the login screen - demo sessions
    // never persist, so the account list starts empty
    await unlock(page, 'correct horse')
    await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible({
      timeout: 10_000
    })

    // disabling returns to plaintext slots: the next reload skips the gate
    await page.getByRole('button', { name: 'Try the demo' }).click()
    await expect(page.getByRole('button', { name: 'demo@badinage.local' })).toBeVisible({
      timeout: 10_000
    })
    const dialog2 = await openPrivacySettings(page)
    await dialog2.getByRole('button', { name: 'Disable', exact: true }).click()
    await page.getByRole('dialog').last().getByRole('button', { name: 'Disable' }).click()
    // the slot reseal is async - Set passphrase reappears once it lands
    await expect(dialog2.getByRole('button', { name: 'Set passphrase' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible({
      timeout: 10_000
    })
  })
})
