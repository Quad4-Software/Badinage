// The extension contribution registry: command claiming and dispatch,
// decoration caching and the settings value flow. Runners are injected
// so no real worker is needed.

import { beforeEach, describe, expect, it } from 'vitest'

import { extApi } from './ext-api.svelte'

const PAYLOAD = { name: 'shrug', args: 'why', accountJid: 'me@a.b', peerJid: 'p@a.b', kind: 'dm' }

describe('ExtApiStore commands', () => {
  beforeEach(() => extApi.clearExtension('ext.a'))

  it('dispatches a claimed command and returns its body', async () => {
    extApi.setCommands('ext.a', [{ id: 'c1', name: 'shrug', description: '' }], async () => ({
      body: '¯\\_(ツ)_/¯'
    }))
    const result = await extApi.runCommand('shrug', PAYLOAD)
    expect(result).toEqual({ handled: true, body: '¯\\_(ツ)_/¯' })
  })

  it('refuses builtin and already-claimed names', async () => {
    const calls: string[] = []
    extApi.setCommands(
      'ext.a',
      [
        { id: 'a', name: 'clear', description: '' },
        { id: 'b', name: 'mine', description: '' }
      ],
      async (itemId) => {
        calls.push(itemId)
        return null
      }
    )
    extApi.setCommands('ext.b', [{ id: 'c', name: 'mine', description: '' }], async () => ({
      body: 'shadow'
    }))
    expect(extApi.hasCommand('clear')).toBe(false)
    expect(extApi.hasCommand('mine')).toBe(true)
    await extApi.runCommand('mine', PAYLOAD)
    // ext.b never took the name: ext.a ran it
    expect(calls).toEqual(['cmd:mine'])
    extApi.clearExtension('ext.b')
  })

  it('reports unhandled for unknown names', async () => {
    expect(await extApi.runCommand('nope', PAYLOAD)).toEqual({ handled: false })
  })
})

describe('ExtApiStore decorations', () => {
  beforeEach(() => extApi.clearExtension('ext.a'))

  it('caches the first non-null decoration per key', async () => {
    let calls = 0
    extApi.setDecorator('ext.a', async () => {
      calls += 1
      return { footer: 'via ext' }
    })
    await extApi.ensureDecoration('a|p|m1', {})
    await extApi.ensureDecoration('a|p|m1', {})
    expect(extApi.decorations.get('a|p|m1')).toEqual({ footer: 'via ext' })
    expect(calls).toBe(1)
  })

  it('stores nothing when the decorator has no opinion', async () => {
    extApi.setDecorator('ext.a', async () => null)
    await extApi.ensureDecoration('a|p|m2', {})
    expect(extApi.decorations.get('a|p|m2')).toBeUndefined()
  })
})

describe('ExtApiStore settings', () => {
  beforeEach(() => extApi.clearExtension('ext.a'))

  it('writes values through the registered writer', () => {
    const writes: [string, unknown][] = []
    extApi.registerSettingsWriter('ext.a', (k, v) => writes.push([k, v]))
    extApi.setSettings('ext.a', [{ key: 'k', type: 'text', label: 'K' }], { k: 'old' })
    extApi.setSettingValue('ext.a', 'k', 'new')
    expect(writes).toEqual([['k', 'new']])
    expect(extApi.settingValues.get('ext.a')).toEqual({ k: 'new' })
  })

  it('drops every contribution on clear', () => {
    extApi.setSettings('ext.a', [{ key: 'k', type: 'text', label: 'K' }], {})
    extApi.setDecorator('ext.a', async () => null)
    extApi.setCommands('ext.a', [{ id: 'c', name: 'mine', description: '' }], async () => null)
    extApi.clearExtension('ext.a')
    expect(extApi.settingFields.get('ext.a')).toBeUndefined()
    expect(extApi.hasCommand('mine')).toBe(false)
  })
})
