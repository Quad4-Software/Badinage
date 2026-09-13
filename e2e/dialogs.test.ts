import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { enterDemo } from './helpers'

// The modal contract: every dialog is labelled, axe-clean and dismissed
// by Escape. New dialogs get a row here instead of bespoke coverage.

interface DialogCase {
  name: string
  // demo signs in first when the trigger lives behind an account
  demo?: boolean
  open: (page: Page) => Promise<unknown>
}

const CASES: DialogCase[] = [
  {
    name: 'settings',
    open: (page) => page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  },
  {
    name: 'crash report prompt',
    open: (page) =>
      page.evaluate(() =>
        (
          window as unknown as {
            __badinagePrompts: { show: (id: string) => void }
          }
        ).__badinagePrompts.show('crash-reporting')
      )
  },
  {
    name: 'join room',
    demo: true,
    open: (page) => page.getByRole('button', { name: 'Join a room' }).click()
  },
  {
    name: 'add contact',
    demo: true,
    open: (page) => page.getByRole('button', { name: 'Add a contact' }).click()
  },
  {
    name: 'explore rooms',
    demo: true,
    open: (page) => page.getByRole('button', { name: 'Explore rooms' }).click()
  },
  {
    name: 'profile',
    demo: true,
    open: async (page) => {
      await page.getByRole('button', { name: 'demo@badinage.local' }).click()
      await page.getByRole('menuitem', { name: 'Edit profile' }).click()
    }
  }
]

for (const c of CASES) {
  test(`${c.name} dialog is labelled, axe-clean and Escape-dismissable`, async ({ page }) => {
    await page.goto('/')
    if (c.demo) await enterDemo(page)
    await c.open(page)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // an accessible name via aria-label or a resolved aria-labelledby
    const labelled = await dialog.evaluate(
      (el) => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
    )
    expect(labelled).toBeTruthy()

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
}
