import { expect, test, type Page } from '@playwright/test'

interface PromptHook {
  show: (id: string) => void
}

async function showCrashPrompt(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { __badinagePrompts: PromptHook }).__badinagePrompts.show(
      'crash-reporting'
    )
  )
}

interface StoredSettings {
  crashReporting?: boolean
  seenPrompts?: Record<string, number>
}

async function storedSettings(page: Page): Promise<StoredSettings> {
  const raw = await page.evaluate(() => localStorage.getItem('badinage:settings'))
  return JSON.parse(raw ?? '{}') as StoredSettings
}

// PersistedState syncs to localStorage reactively after the state
// change, so assertions poll instead of reading once
async function expectStored(
  page: Page,
  crashReporting: boolean,
  seenVersion: number
): Promise<void> {
  await expect
    .poll(async () => {
      const stored = await storedSettings(page)
      return [stored.crashReporting, stored.seenPrompts?.['crash-reporting']]
    })
    .toEqual([crashReporting, seenVersion])
}

test('crash report prompt shows a scrubbed sample and opts in', async ({ page }) => {
  await page.goto('/')
  await showCrashPrompt(page)

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Share crash reports?')).toBeVisible()

  // the sample proves scrubbing: redacted address markers present, no
  // stanza XML or message payloads
  await dialog.getByText('See a sample scrubbed report').click()
  const sample = dialog.locator('pre')
  await expect(sample).toBeVisible()
  const text = await sample.textContent()
  expect(text).toContain('[redacted-address]')
  expect(text).not.toContain('<message')
  expect(text).not.toContain('<body>')

  await dialog.getByRole('button', { name: 'Enable crash reports' }).click()
  await expect(dialog).toBeHidden()
  await expectStored(page, true, 1)
})

test('declining the crash report prompt leaves reporting off', async ({ page }) => {
  await page.goto('/')
  await showCrashPrompt(page)

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'No thanks' }).click()
  await expect(dialog).toBeHidden()
  await expectStored(page, false, 1)
})

test('dismissing the crash report prompt still counts as answered', async ({ page }) => {
  await page.goto('/')
  await showCrashPrompt(page)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expectStored(page, false, 1)
})

test('the sample report is reachable from privacy settings', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByText('See a sample scrubbed report').click()
  const sample = dialog.locator('pre')
  await expect(sample).toBeVisible()
  expect(await sample.textContent()).toContain('[redacted-address]')
})
