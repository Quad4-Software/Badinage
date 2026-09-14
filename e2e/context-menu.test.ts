import { expect, test, type Page } from '@playwright/test'

import { enterDemo } from './helpers'

// desktop only: on touch the same gestures open the action sheet
// instead of the pointer menu
test.describe('context menu', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'touch uses the action sheet')

  async function openAriaChat(page: Page) {
    await enterDemo(page)
    // exact name: the invitation row also contains aria@ in its
    // accessible name and appears earlier in the list
    await page.getByRole('button', { name: 'Aria Voice message' }).click()
  }

  test('opens on a message row with keyboard navigation and Escape', async ({ page }) => {
    await openAriaChat(page)
    const input = page.getByLabel(/Message Aria/)
    await input.fill('ctx test')
    await input.press('Enter')
    // pending messages carry no menu, so let the demo echo settle first
    const row = page.locator('li').filter({ hasText: 'ctx test' })
    await page.waitForTimeout(500)
    await row.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    // an outgoing message offers edit and retract, never moderate
    await expect(menu.getByRole('menuitem', { name: 'Reply' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Edit message' })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('role'))
    expect(focused).toBe('menuitem')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })

  test('copy message writes the body to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openAriaChat(page)
    const input = page.getByLabel(/Message Aria/)
    await input.fill('copy me now')
    await input.press('Enter')
    await page.waitForTimeout(500)
    await page.locator('li').filter({ hasText: 'copy me now' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy message text' }).click()
    await expect(page.getByRole('menu')).toBeHidden()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('copy me now')
  })

  test('clamps inside the viewport near an edge', async ({ page }) => {
    await enterDemo(page)
    // right-click the dead space at the bottom of the sidebar nav so
    // the menu opens against the viewport floor and must clamp upward
    const nav = page.getByRole('navigation', { name: 'Conversations' })
    const navBox = await nav.boundingBox()
    await nav.click({ button: 'right', position: { x: 20, y: (navBox?.height ?? 0) - 4 } })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    const viewport = page.viewportSize()
    expect(box?.x).toBeGreaterThanOrEqual(0)
    expect(box?.y).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0)
  })

  test('opens on the account switcher, chat header and sidebar space', async ({ page }) => {
    await openAriaChat(page)
    await page.getByRole('button', { name: 'demo@badinage.local' }).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Copy address' })).toBeVisible()
    await page.keyboard.press('Escape')

    // the h1 is not a button so the header menu applies to it
    await page.getByRole('heading', { name: /Aria/ }).click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Copy address' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    const nav = page.getByRole('navigation', { name: 'Conversations' })
    const box = await nav.boundingBox()
    // the bottom padding is dead space below the last row
    await nav.click({ button: 'right', position: { x: 20, y: (box?.height ?? 0) - 4 } })
    await expect(menu.getByRole('menuitem', { name: 'Join a room' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Join a room' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('closes on an outside click', async ({ page }) => {
    await enterDemo(page)
    await page.getByRole('button', { name: /Aria/ }).first().click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await page.mouse.click(10, 10)
    await expect(menu).toBeHidden()
  })
})
