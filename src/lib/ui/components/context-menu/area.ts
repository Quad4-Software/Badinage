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
  // resolve a menu when the click lands on a link inside the area.
  // Without it links keep their native menu, and returning null keeps
  // it for that link too
  link?: (href: string) => { section?: MenuSection; payload?: unknown; items: MenuItem[] } | null
  // extra veto for children that should keep the native menu
  skip?: (target: Element) => boolean
}

export function contextArea(args: AreaArgs): Attachment {
  return (node) => {
    const open = (
      event: MouseEvent,
      section: MenuSection,
      payload: unknown,
      items: MenuItem[]
    ): boolean => {
      if (!menus.open(event.clientX, event.clientY, section, payload, items)) return false
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    const onContextMenu = (raw: Event) => {
      const event = raw as MouseEvent
      if (event instanceof PointerEvent && event.pointerType === 'touch') return
      if (Date.now() - lastLongPressAt() < LONGPRESS_DEDUP_MS) {
        event.preventDefault()
        return
      }
      if (!(event.target instanceof Element)) return
      // links get their own menu only when the area opts in
      const anchor = event.target.closest('a[href]')
      if (anchor) {
        const href = anchor.getAttribute('href')
        const resolved = href ? args.link?.(href) : null
        if (resolved) {
          open(
            event,
            resolved.section ?? args.section,
            resolved.payload ?? args.payload,
            resolved.items
          )
        }
        return
      }
      // keep the native menu on editable text and selections
      if (event.target.closest('input, textarea')) return
      if (args.skip?.(event.target)) return
      if (window.getSelection()?.toString()) return
      // the registry merges extension items, so it decides whether a
      // menu exists even when the built-in list is empty
      open(event, args.section, args.payload, args.items())
    }
    node.addEventListener('contextmenu', onContextMenu)
    return () => node.removeEventListener('contextmenu', onContextMenu)
  }
}
