import { expect, test, type Browser, type Page } from '@playwright/test'

const WS_URL = 'ws://localhost:5280/xmpp-websocket'
const BAD_WS_URL = 'ws://localhost:1/xmpp-websocket'
const ALICE = { jid: 'e2e-alice@localhost', password: 'e2e-alice-pass' }
const BOB = { jid: 'e2e-bob@localhost', password: 'e2e-bob-pass' }
const ROOM = 'e2e-room@conference.localhost'
const CONNECT_TIMEOUT = 15_000

// the account switcher shows the jid the moment the account is added, so
// also wait for the online presence dot to prove the session connected
async function loginAs(page: Page, jid: string, password: string, server = WS_URL) {
  await page.goto('/')
  await page.getByLabel('XMPP address').fill(jid)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Server').fill(server)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('button', { name: `online ${jid}` })).toBeVisible({
    timeout: CONNECT_TIMEOUT
  })
}

async function openPair(
  browser: Browser
): Promise<{ alice: Page; bob: Page; close: () => Promise<void> }> {
  const aliceCtx = await browser.newContext()
  const bobCtx = await browser.newContext()
  const alice = await aliceCtx.newPage()
  const bob = await bobCtx.newPage()
  await loginAs(alice, ALICE.jid, ALICE.password)
  await loginAs(bob, BOB.jid, BOB.password)
  return {
    alice,
    bob,
    close: async () => {
      await aliceCtx.close()
      await bobCtx.close()
    }
  }
}

async function joinRoom(page: Page, room: string, nick: string) {
  await page.getByRole('button', { name: 'Join a room' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Room address').fill(room)
  await dialog.getByLabel('Nickname').fill(nick)
  await dialog.getByRole('button', { name: 'Join' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('against the dev prosody container', () => {
  test.skip(process.env.E2E_PROSODY !== '1', 'needs the dev prosody container')

  // these specs share the same seeded accounts, and a second project would
  // sign in as the same jids in parallel and exchange stanzas with itself,
  // so they run on the chromium project only
  // browserName is chromium for both projects, so gate on the project name
  test.beforeEach(({ browserName: _browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'chromium only')
  })

  test('signs in over websocket', async ({ page }) => {
    await loginAs(page, ALICE.jid, ALICE.password)
  })

  test('alice and bob exchange a direct message', async ({ browser }) => {
    test.setTimeout(60_000)
    const { alice, bob, close } = await openPair(browser)
    try {
      const body = `hello bob ${Date.now().toString(36)}`

      await alice.getByRole('button', { name: 'Add a contact' }).click()
      const dialog = alice.getByRole('dialog')
      await dialog.getByLabel('Contact address').fill(BOB.jid)
      await dialog.getByRole('button', { name: 'Add' }).click()
      await expect(dialog).toBeHidden()

      // prosody routes chat messages regardless of subscription state, and on
      // a reused dev volume the pair may already be subscribed (no request
      // shown again), so the test does not depend on the subscription accept
      const contact = alice.getByRole('button', { name: BOB.jid }).first()
      await expect(contact).toBeVisible({ timeout: CONNECT_TIMEOUT })
      await contact.click()
      const input = alice.getByLabel(`Message ${BOB.jid}`)
      await input.fill(body)
      await input.press('Enter')

      const row = bob.getByRole('button', { name: ALICE.jid }).first()
      await expect(row).toBeVisible({ timeout: CONNECT_TIMEOUT })
      await row.click()
      await expect(bob.locator('ol').getByText(body)).toBeVisible({
        timeout: CONNECT_TIMEOUT
      })
    } finally {
      await close()
    }
  })

  test('alice and bob meet in a muc room', async ({ browser }) => {
    test.setTimeout(60_000)
    const { alice, bob, close } = await openPair(browser)
    try {
      // unique room and nicks per run: stale occupants from a previous run
      // must not collide with the join or the occupant count
      const run = Date.now().toString(36)
      const room = ROOM.replace('@', `-${run}@`)
      const nickAlice = `alice-${run}`
      const nickBob = `bob-${run}`
      const body = `hi room ${run}`

      await joinRoom(alice, room, nickAlice)
      await joinRoom(bob, room, nickBob)

      await expect(alice.getByRole('button', { name: '2 occupants' })).toBeVisible({
        timeout: CONNECT_TIMEOUT
      })
      const occupants = bob.getByRole('button', { name: '2 occupants' })
      await expect(occupants).toBeVisible({ timeout: CONNECT_TIMEOUT })

      const input = alice.getByLabel(`Message ${room.split('@')[0]}`)
      await input.fill(body)
      await input.press('Enter')
      await expect(bob.locator('ol').getByText(body)).toBeVisible({
        timeout: CONNECT_TIMEOUT
      })

      await occupants.click()
      const aside = bob.locator('aside')
      await expect(aside.getByText(nickAlice)).toBeVisible()
      await expect(aside.getByText(nickBob)).toBeVisible()
    } finally {
      await close()
    }
  })

  test('shows an error for an unreachable server', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('XMPP address').fill(ALICE.jid)
    await page.getByLabel('Password', { exact: true }).fill(ALICE.password)
    await page.getByLabel('Server').fill(BAD_WS_URL)
    await page.getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByRole('alert')).toHaveText('Could not reach the server', {
      timeout: CONNECT_TIMEOUT
    })
  })
})
