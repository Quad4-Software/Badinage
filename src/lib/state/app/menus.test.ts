import { describe, expect, it } from 'vitest'

import { menus } from './menus.svelte'

describe('MenuRegistry', () => {
  it('opens with built-in items only', () => {
    menus.open(10, 20, 'chat.message', {}, [{ id: 'a', label: 'A', run: () => undefined }])
    expect(menus.opened?.items).toHaveLength(1)
    menus.close()
    expect(menus.opened).toBeNull()
  })

  it('stays closed when no items apply', () => {
    menus.open(0, 0, 'chat.message', {}, [])
    expect(menus.opened).toBeNull()
  })

  it('appends extension items for the matching section only', () => {
    const calls: string[] = []
    menus.registerExtension('ext.one', (itemId) => calls.push(itemId))
    menus.setExtensionItems('ext.one', [
      { id: 'm1', section: 'chat.message', label: 'Ext thing' },
      { id: 'm2', section: 'sidebar.conversation', label: 'Other' }
    ])
    menus.open(5, 5, 'chat.message', { body: 'hi' }, [{ id: 'a', label: 'A' }])
    const labels = menus.opened?.items.map((i) => i.label)
    expect(labels).toEqual(['A', 'Ext thing'])
    menus.opened?.items[1]?.run?.()
    expect(calls).toEqual(['m1'])
    menus.unregisterExtension('ext.one')
    menus.close()
  })

  it('caps extension items at the limit', () => {
    menus.registerExtension('ext.two', () => undefined)
    menus.setExtensionItems(
      'ext.two',
      Array.from({ length: 25 }, (_, i) => ({
        id: `i${i}`,
        section: 'chat.message',
        label: `item ${i}`
      }))
    )
    menus.open(0, 0, 'chat.message', {}, [])
    expect(menus.opened?.items).toHaveLength(10)
    menus.unregisterExtension('ext.two')
    menus.close()
  })

  it('opens on extension items even without built-ins', () => {
    menus.registerExtension('ext.three', () => undefined)
    menus.setExtensionItems('ext.three', [{ id: 'x', section: 'chat.message', label: 'X' }])
    expect(menus.open(0, 0, 'chat.message', {}, [])).toBe(true)
    expect(menus.opened?.items[0]?.id).toBe('ext:ext.three:x')
    menus.unregisterExtension('ext.three')
    menus.close()
  })
})
