import { expect, test } from '@playwright/test'

import { enterDemo } from './helpers'

test.describe('layout metrics', () => {
  for (const width of [375, 768, 1280]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow).toBeLessThanOrEqual(1)
    })
  }

  test('interactive elements meet the 24px minimum target size', async ({ page }) => {
    await page.goto('/')
    const controls = page.locator('input, button, [role="checkbox"], a[href]')
    for (const el of await controls.all()) {
      const box = await el.boundingBox()
      if (!box) continue
      expect(box.width, `width of ${await el.getAttribute('id')}`).toBeGreaterThanOrEqual(24)
      expect(box.height, `height of ${await el.getAttribute('id')}`).toBeGreaterThanOrEqual(24)
    }
  })

  test('all controls have accessible names', async ({ page }) => {
    await page.goto('/')
    for (const el of await page.locator('input, button').all()) {
      const name = await el.evaluate(
        (node) =>
          node.getAttribute('aria-label') ||
          node.getAttribute('aria-labelledby') ||
          (node instanceof HTMLInputElement && node.placeholder) ||
          node.textContent?.trim() ||
          ((node instanceof HTMLInputElement || node instanceof HTMLButtonElement) &&
            node.labels?.length &&
            node.labels[0]?.textContent?.trim())
      )
      expect(name).toBeTruthy()
    }
  })
})

test.describe('settings dialog', () => {
  test('opens with the keyboard shortcut and traps focus', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const focused = await page.evaluate(() => document.activeElement?.tagName)
    expect(focused).toBeTruthy()

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
    }
    const stillInside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      return dialog?.contains(document.activeElement) ?? false
    })
    expect(stillInside).toBe(true)
  })

  test('dialog overlays page content with a backdrop', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const zIndex = await dialog.evaluate((el) => getComputedStyle(el).zIndex)
    expect(Number(zIndex)).toBeGreaterThanOrEqual(50)
  })

  test('keybinding can be rebound and persists', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()

    const rebind = dialog.getByRole('button', { name: 'Rebind Toggle theme' })
    await rebind.click()
    await page.keyboard.press('Alt+Shift+t')
    await expect(dialog.getByText('Alt+Shift+T')).toBeVisible()

    await page.reload()
    await page.keyboard.press('Control+,')
    await expect(page.getByRole('dialog').getByText('Alt+Shift+T')).toBeVisible()
  })

  test('escape closes the dialog', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+,')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('theme preset applies root tokens and persists', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Ocean' }).click()
    const primary = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--primary')
    )
    expect(primary).toContain('oklch')

    await page.reload()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--primary')))
      .toContain('oklch')
  })

  test('a collapsed section hides its rows and stays collapsed', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Color scheme')).toBeVisible()
    await dialog.getByRole('button', { name: 'Collapse Appearance' }).click()
    await expect(dialog.getByText('Color scheme')).toBeHidden()

    await page.reload()
    await page.keyboard.press('Control+,')
    await expect(page.getByRole('dialog').getByText('Color scheme')).toBeHidden()
    // reset for the next test
    await page.getByRole('dialog').getByRole('button', { name: 'Expand Appearance' }).click()
  })

  test('reset settings restores defaults', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Ocean' }).click()
    await dialog.getByRole('button', { name: 'Reset settings' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset settings' }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--primary')))
      .toBe('')
  })

  test('backup export and import round-trips settings', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Ocean' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Export' }).click()
    ])
    const path = await download.path()
    expect(path).toBeTruthy()

    await dialog.getByRole('radio', { name: 'Default', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--primary')))
      .toBe('')

    await dialog.locator('input[type="file"]').setInputFiles(path ?? '')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--primary')))
      .toContain('oklch')
  })

  test('import rejects a file that is not a backup', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'junk.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"not":"ours"}')
    })
    await expect(page.getByText('Could not import that file')).toBeVisible()
  })
})

test.describe('reaction picker', () => {
  // desktop only: on touch the hover action bar does not exist and the
  // sheet renders an embedded picker instead of the portaled one
  test.skip(({ isMobile }) => Boolean(isMobile), 'touch uses the action sheet')
  test('stays fully inside the viewport near the composer', async ({ page }) => {
    await enterDemo(page)
    await page.getByRole('button', { name: /Aria/ }).first().click()
    const input = page.getByLabel(/Message Aria/)
    // the newest row sits directly against the composer, which is the
    // clip case: a bottom-anchored picker has no room to open below
    await input.fill('clip check')
    await input.press('Enter')
    const row = page.locator('li').filter({ hasText: 'clip check' })
    await row.hover()
    // the bottom trigger anchors the picker below the bubble, the path
    // that used to clip against the composer
    await row.getByRole('button', { name: 'Add reaction' }).last().click()
    const picker = page.getByRole('dialog', { name: 'Pick an emoji' })
    await expect(picker).toBeVisible()
    const box = await picker.boundingBox()
    const viewport = page.viewportSize()
    expect(box?.x).toBeGreaterThanOrEqual(0)
    expect(box?.y).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0)
  })
})

test.describe('dom stability', () => {
  // run before login so no demo traffic or message rendering can move
  // the baseline. The settings dialog is a portaled overlay: nodes left
  // behind after close are a leak
  test('repeated overlays do not leak nodes', async ({ page }) => {
    await page.goto('/')
    const nodeCount = () => page.evaluate(() => document.getElementsByTagName('*').length)
    const before = await nodeCount()
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Control+,')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
    }
    expect((await nodeCount()) - before).toBeLessThanOrEqual(4)
  })
})
