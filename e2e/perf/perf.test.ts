import { expect, test, type Page } from '@playwright/test'

import { enterDemo } from '../helpers'

// Performance gates against the built app: paint budgets on the login
// page, heap growth and DOM bounds under the ?stress flood, and longtask
// ceilings during ingest. The app-side budgets live in core/perf.ts; the
// numbers asserted here are the CI-enforceable half of that contract.
//
// Heap reads go through CDP, so the heavy specs are desktop-chromium
// only. The vitals spec runs everywhere.

interface Snapshot {
  fcpMs?: number
  lcpMs?: number
  cls: number
  longtasks: { count: number; maxMs: number; totalMs: number; recent: number[] }
  heapUsedBytes?: number
  heapPeakBytes?: number
  violations: string[]
}

interface PerfHook {
  snapshot(): Snapshot
}

interface StressTracker {
  emitted: number
  total: number
}

async function perf(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const hook = (globalThis as Record<string, unknown>).__badinagePerf as PerfHook | undefined
    return (
      hook?.snapshot() ?? {
        cls: 0,
        longtasks: { count: 0, maxMs: 0, totalMs: 0, recent: [] },
        violations: ['missing perf hook']
      }
    )
  })
}

async function waitForStress(page: Page) {
  await page.waitForFunction(
    () => {
      const s = (globalThis as Record<string, unknown>).__badinageStress as
        StressTracker | undefined
      return s !== undefined && s.emitted >= s.total
    },
    { timeout: 60_000 }
  )
}

async function jsHeap(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  const metrics = await session.send('Performance.getMetrics')
  await session.detach()
  return metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? -1
}

async function collectGarbage(page: Page) {
  const session = await page.context().newCDPSession(page)
  await session.send('HeapProfiler.enable')
  await session.send('HeapProfiler.collectGarbage')
  await session.detach()
}

test('login page paints inside the vitals budget', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible()
  // buffered paint entries reach the observer a task or two after
  // registration, so poll instead of reading once
  await expect.poll(async () => (await perf(page)).fcpMs, { timeout: 10_000 }).toBeGreaterThan(0)
  const snap = await perf(page)
  expect(snap.fcpMs ?? Infinity).toBeLessThan(2_000)
  expect(snap.lcpMs ?? Infinity).toBeLessThan(3_000)
  expect(snap.cls).toBeLessThan(0.1)
  expect(snap.violations).toEqual([])
})

test.describe('stress flood', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'heap reads need desktop CDP')
  test.describe.configure({ mode: 'serial' })

  test('ingests the flood without runaway heap or task stalls', async ({ page }) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await enterDemo(page, '/?stress=150,40,3000')
    await waitForStress(page)

    // settle: let the last chunk render and timers drain
    await page.waitForTimeout(1500)
    const snap = await perf(page)
    // chunked delivery should keep every task under a second even on ci
    expect(snap.longtasks.maxMs).toBeLessThan(2_000)

    await collectGarbage(page)
    const heap = await jsHeap(page)
    // 150 contacts, 40 rooms and 3000 messages plus the shell. A leak in
    // ingest or a missing live cap would push well past this
    expect(heap).toBeGreaterThan(0)
    expect(heap).toBeLessThan(200 * 1024 * 1024)
    expect(errors).toEqual([])
  })

  test('opening a big conversation keeps the DOM bounded', async ({ page }) => {
    test.setTimeout(90_000)
    await enterDemo(page, '/?stress=50,10,2000')
    await waitForStress(page)
    await page.waitForTimeout(1000)

    // a stress dm carries ~40 messages after the spread; send a burst to
    // make the open conversation visibly long
    const row = page.getByRole('button', { name: /Stress Contact 0/ }).first()
    await row.click()
    await page.waitForTimeout(500)
    const input = page.getByLabel(/Message Stress Contact 0/)
    for (let i = 0; i < 60; i++) {
      await input.fill(`perf ${i}`)
      await input.press('Enter')
    }
    await page.waitForTimeout(800)

    const mounted = await page.evaluate(() => document.querySelectorAll('li[id^="m-"]').length)
    expect(mounted).toBeGreaterThan(3)
    expect(mounted).toBeLessThan(80)

    // the scroller stays pinned at the tail during the burst. Demo
    // replies keep landing for a few seconds after the last send, so
    // poll until the tail is reached rather than sampling once
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const ol = document.querySelector('ol:has(li[id^="m-"])')
            let vp = ol?.parentElement ?? null
            while (vp && !/auto|scroll/.test(getComputedStyle(vp).overflowY)) {
              vp = vp.parentElement
            }
            return vp ? vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 40 : false
          }),
        { timeout: 10_000 }
      )
      .toBe(true)
  })

  test('heap stays flat across repeated conversation switches', async ({ page }) => {
    test.setTimeout(90_000)
    await enterDemo(page, '/?stress=60,20,1500')
    await waitForStress(page)
    await page.waitForTimeout(1000)
    await collectGarbage(page)
    const before = await jsHeap(page)

    // switch between conversations 20 times: each open mounts the list
    // and rows, a listener or cache leak would accumulate here
    for (let i = 0; i < 20; i++) {
      await page
        .getByRole('button', { name: new RegExp(`Stress Contact ${i % 10}`) })
        .first()
        .click()
      await page.waitForTimeout(120)
    }
    await page.waitForTimeout(800)
    await collectGarbage(page)
    const after = await jsHeap(page)
    expect(after - before).toBeLessThan(40 * 1024 * 1024)
  })
})
