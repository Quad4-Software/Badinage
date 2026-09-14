import { expect, test, type Page } from '@playwright/test'

import { enterDemo } from '../helpers'

// an unsigned package exercising every contribution type: a message
// menu item, a slash command, a settings field and a decorator
const PKG = JSON.stringify({
  manifest: {
    id: 'test.echo',
    name: 'Echo Test',
    version: '1.0.0',
    api: 1,
    permissions: ['menus', 'toast', 'commands', 'messages.decorate', 'settings'],
    connect: []
  },
  code: `
badinage.menus.add('chat.message', {id:'ping', label:'Ping it'}, function(){ badinage.toast('pong') })
badinage.commands.add({name:'echo', description:'echo back'}, function(p){ return {body:'echo: '+p.args} })
badinage.messages.decorate(function(){ return {footer:'ext deco'} })
badinage.settings.define([{key:'greeting', type:'text', label:'Greeting', default:'hi'}])
`
})

test.describe('extensions', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop context menu flow')

  async function install(page: Page) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Extensions', exact: true }).click()
    await dialog.getByRole('switch', { name: 'Allow unsigned extensions' }).click()
    await dialog.locator('[data-section="extensions"] input[type="file"]').setInputFiles({
      name: 'echo.badinage.json',
      mimeType: 'application/json',
      buffer: Buffer.from(PKG)
    })
    await expect(dialog.getByText('Echo Test')).toBeVisible()
  }

  test('installs, runs menus, commands and decorators', async ({ page }) => {
    await enterDemo(page)
    await install(page)
    // the declared settings field earns a configure button
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Configure Echo Test' })
    ).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Aria Voice message' }).click()

    // menu item: right click a message, run the extension's item
    const input = page.getByLabel(/Message Aria/)
    await input.fill('ext target')
    await input.press('Enter')
    await page.waitForTimeout(600)
    await page.locator('li').filter({ hasText: 'ext target' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Ping it' }).click()
    await expect(page.locator('[data-sonner-toast]').getByText('pong')).toBeVisible()

    // slash command: the worker answers with a body we send
    await input.fill('/echo hello ext')
    await input.press('Enter')
    await expect(page.locator('li').filter({ hasText: 'echo: hello ext' })).toBeVisible({
      timeout: 10_000
    })

    // decorator: a footer lands under rendered messages
    await expect(page.getByText('ext deco').first()).toBeVisible({ timeout: 10_000 })
  })
})
