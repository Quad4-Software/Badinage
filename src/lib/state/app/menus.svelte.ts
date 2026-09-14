// App-wide context menu registry. Components attach the contextArea
// attachment with a section id, a payload and their built-in items.
// Enabled extensions can append items to any section through
// registerExtension, which is what makes the menu extensible without
// components knowing about extensions at all.

import type { Component } from 'svelte'

import type { ExtMenuItem } from '$lib/core/extensions/types'

export interface MenuItem {
  id: string
  label: string
  icon?: Component
  danger?: boolean
  disabled?: boolean
  // a separator ignores every other field
  separator?: boolean
  run?: () => void
}

// section ids extensions may contribute to. Kept as a plain string so
// future sections need no registry change, but the known set is
// documented for extension authors
export type MenuSection =
  'chat.message' | 'sidebar.conversation' | 'sidebar.account' | (string & {})

interface MenuOpen {
  x: number
  y: number
  section: string
  items: MenuItem[]
}

// runs an extension's menu item. The runner receives the payload the
// area supplied and is responsible for scrubbing fields the extension
// lacks permission to see before it crosses the worker boundary
type ExtRunner = (itemId: string, payload: unknown) => void

const MAX_EXTENSION_ITEMS = 10

class MenuRegistry {
  opened = $state<MenuOpen | null>(null)

  private items = new Map<string, ExtMenuItem[]>()
  private runners = new Map<string, ExtRunner>()

  registerExtension(extId: string, runner: ExtRunner): void {
    this.runners.set(extId, runner)
  }

  unregisterExtension(extId: string): void {
    this.runners.delete(extId)
    this.items.delete(extId)
  }

  // replaces the extension's full contribution list. Called when the
  // worker announces its menus at startup
  setExtensionItems(extId: string, items: ExtMenuItem[]): void {
    this.items.set(extId, items.slice(0, MAX_EXTENSION_ITEMS))
  }

  // returns true when a menu actually opened so the caller can decide
  // whether to suppress the native menu
  open(x: number, y: number, section: MenuSection, payload: unknown, items: MenuItem[]): boolean {
    const merged = [...items]
    for (const [extId, list] of this.items) {
      const runner = this.runners.get(extId)
      if (!runner) continue
      for (const item of list) {
        if (item.section !== section) continue
        merged.push({
          id: `ext:${extId}:${item.id}`,
          label: item.label,
          danger: item.danger === true,
          run: () => runner(item.id, payload)
        })
      }
    }
    if (merged.length === 0) return false
    this.opened = { x, y, section, items: merged }
    return true
  }

  close(): void {
    this.opened = null
  }
}

export const menus = new MenuRegistry()
