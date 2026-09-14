// Attachment that turns any element into a context-menu target.
// Touch long-press is handled by the longPress attachment instead: on
// mobile browsers that gesture also emits contextmenu, so events with
// a touch pointer or inside the double-fire window are skipped. Links
// keep their native menu.

import type { Attachment } from 'svelte/attachments'

import { lastLongPressAt, LONGPRESS_DEDUP_MS } from '$lib/ui/long-press'
import { menus, type MenuItem, type MenuSection } from '$lib/state/app/menus.svelte'

export interface AreaArgs {
  section: MenuSection
  payload?: unknown
  items: () => MenuItem[]
}

export function contextArea(args: AreaArgs): Attachment {
  return (node) => {
    const onContextMenu = (raw: Event) => {
      const event = raw as MouseEvent
      if (event instanceof PointerEvent && event.pointerType === 'touch') return
      if (Date.now() - lastLongPressAt() < LONGPRESS_DEDUP_MS) {
        event.preventDefault()
        return
      }
      // keep the native menu on links, editable text and selections
      if (event.target instanceof Element && event.target.closest('a, input, textarea')) return
      if (window.getSelection()?.toString()) return
      // the registry merges extension items, so it decides whether a
      // menu exists even when the built-in list is empty
      if (!menus.open(event.clientX, event.clientY, args.section, args.payload, args.items()))
        return
      event.preventDefault()
      event.stopPropagation()
    }
    node.addEventListener('contextmenu', onContextMenu)
    return () => node.removeEventListener('contextmenu', onContextMenu)
  }
}
