import { expect, test, type Page } from '@playwright/test'

import { enterDemo } from '../helpers'

// the message list renders through virtua: only a window of rows mounts,
// sizes are measured and the scroll position is anchored on prepends.
// These specs exercise the behavior against the built app.

async function openAria(page: Page) {
  await enterDemo(page)
  // exact name: the invitation row also contains aria@ in its
  // accessible name and appears earlier in the list
  await page.getByRole('button', { name: 'Aria Voice message' }).click()
}

const listLoc = 'ol:has(li[id^="m-"])'

async function scrollInfo(page: Page) {
  return page.evaluate(() => {
    const ol = document.querySelector('ol:has(li[id^="m-"])')
    let vp = ol?.parentElement ?? null
    while (vp && !/auto|scroll/.test(getComputedStyle(vp).overflowY)) vp = vp.parentElement
    return {
      scrollTop: vp?.scrollTop ?? -1,
      scrollHeight: vp?.scrollHeight ?? -1,
      clientHeight: vp?.clientHeight ?? -1,
      mounted: ol?.querySelectorAll('li[id^="m-"]').length ?? -1,
      total: 0
    }
  })
}

async function setScroll(page: Page, top: number | 'bottom') {
  await page
    .locator(listLoc)
    .first()
    .evaluate((el, t) => {
      let vp = el.parentElement
      while (vp && !/auto|scroll/.test(getComputedStyle(vp).overflowY)) vp = vp.parentElement
      if (vp) vp.scrollTop = t === 'bottom' ? vp.scrollHeight : t
    }, top)
}

async function sendMessages(page: Page, n: number, prefix: string) {
  const input = page.getByLabel(/Message Aria/)
  for (let i = 0; i < n; i++) {
    await input.fill(`${prefix} ${i}`)
    await input.press('Enter')
  }
}

function atBottom(info: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  return info.scrollTop + info.clientHeight >= info.scrollHeight - 40
}

test.describe('virtualized message list', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop layout only')

  test('mounts only a window of rows and stays pinned through a burst', async ({ page }) => {
    await openAria(page)
    await sendMessages(page, 40, 'burst')
    await page.waitForTimeout(1000)
    const info = await scrollInfo(page)
    expect(info.mounted).toBeGreaterThan(3)
    // 80+ messages exist after echoes; the dom stays bounded
    expect(info.mounted).toBeLessThan(60)
    expect(atBottom(info)).toBe(true)
  })

  test('keeps the anchor message in view when older history prepends', async ({ page }) => {
    await openAria(page)
    await setScroll(page, 0)
    await page.waitForTimeout(400)
    const firstId = await page.evaluate(() => document.querySelector('li[id^="m-"]')?.id ?? '')
    expect(firstId).not.toBe('')
    const pager = page.getByRole('button', { name: 'Load older messages' })
    await expect(pager).toBeVisible()
    await pager.click()
    await page.waitForTimeout(1500)
    const info = await scrollInfo(page)
    // the prepend shifted the scroll offset down instead of leaving
    // the viewport at zero over the new head
    expect(info.scrollTop).toBeGreaterThan(0)
    await expect(page.locator(`#${firstId}`)).toBeInViewport()
  })

  test('scroll-to-latest button appears away from the tail and lands at the end', async ({
    page
  }) => {
    await openAria(page)
    await sendMessages(page, 20, 'far')
    await page.waitForTimeout(600)
    await setScroll(page, 0)
    await page.waitForTimeout(400)
    const btn = page.getByRole('button', { name: 'Jump to latest message' })
    await expect(btn).toBeVisible()
    await btn.click()
    await page.waitForTimeout(1000)
    const info = await scrollInfo(page)
    expect(atBottom(info)).toBe(true)
    await expect(btn).toBeHidden()
  })

  test('quote chip jumps to an unmounted row', async ({ page }) => {
    await openAria(page)
    const input = page.getByLabel(/Message Aria/)
    await input.fill('quote target')
    await input.press('Enter')
    await page.waitForTimeout(500)
    // push the target outside the mounted window
    await sendMessages(page, 40, 'filler')
    await page.waitForTimeout(800)
    // scroll back up so the target mounts, then reply to it
    await setScroll(page, 0)
    await page.waitForTimeout(500)
    const targetRow = page.locator('li').filter({ hasText: 'quote target' }).last()
    await targetRow.scrollIntoViewIfNeeded()
    await targetRow.click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Reply' }).click()
    await input.fill('quote reply')
    await input.press('Enter')
    // the send landed at the tail while we are scrolled mid-list
    await setScroll(page, 'bottom')
    // back at the tail: the reply row is mounted, the target is not.
    // the quote chip itself echoes the target text, so exclude the
    // reply row from the target locator
    const replyRow = page.locator('li').filter({ hasText: 'quote reply' }).last()
    await expect(replyRow).toBeVisible({ timeout: 8000 })
    const targetLoc = page
      .locator('li')
      .filter({ hasText: 'quote target', hasNotText: 'quote reply' })
    expect(await targetLoc.count()).toBe(0)
    await replyRow.getByRole('button').first().click()
    await page.waitForTimeout(800)
    await expect(targetLoc.last()).toBeInViewport()
  })

  test('switching conversations resets to the tail without stale scroll', async ({ page }) => {
    await openAria(page)
    await sendMessages(page, 25, 'sw')
    await page.waitForTimeout(600)
    await setScroll(page, 0)
    await page.waitForTimeout(300)
    await page
      .getByRole('button', { name: /Badinage lobby/ })
      .first()
      .click()
    await page.waitForTimeout(600)
    // the conversation row sits before contact and invite rows that
    // also start with Aria in their accessible names
    await page
      .getByRole('button', { name: /^Aria / })
      .first()
      .click()
    await page.waitForTimeout(800)
    const info = await scrollInfo(page)
    expect(atBottom(info)).toBe(true)
    // the mounted window covers the tail of the history
    const lastRow = page.locator(`${listLoc} > li`).last()
    await expect(lastRow).toBeInViewport()
  })
})
