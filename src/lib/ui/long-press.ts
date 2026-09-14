import type { Attachment } from 'svelte/attachments'

import { tick } from './interactions'

const HOLD_MS = 500
const MOVE_CANCEL_PX = 10
// a contextmenu that lands right after the touch timer fired is the same
// gesture on some mobile browsers, so it is deduped within this window
export const LONGPRESS_DEDUP_MS = 700

let lastFire = 0

// when the most recent touch long-press fired, used by contextArea to
// suppress the contextmenu event the same gesture produces
export function lastLongPressAt(): number {
  return lastFire
}

// Fires on touch press-and-hold only. Desktop right click is handled by
// the contextArea attachment. Pointer movement past the threshold cancels
// the timer so scrolling never triggers it.
export function longPress(handler: () => void): Attachment<HTMLElement> {
  return (node) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let startX = 0
    let startY = 0
    let firedAt = 0

    const cancel = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      startX = event.clientX
      startY = event.clientY
      cancel()
      timer = setTimeout(() => {
        timer = null
        firedAt = Date.now()
        lastFire = firedAt
        tick()
        handler()
      }, HOLD_MS)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (timer === null) return
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) cancel()
    }

    const onContextMenu = (event: MouseEvent) => {
      // desktop right click belongs to contextArea. This listener only
      // suppresses the contextmenu a touch long-press still produces
      if (Date.now() - firedAt < LONGPRESS_DEDUP_MS) event.preventDefault()
    }

    node.addEventListener('pointerdown', onPointerDown)
    node.addEventListener('pointermove', onPointerMove)
    node.addEventListener('pointerup', cancel)
    node.addEventListener('pointercancel', cancel)
    node.addEventListener('contextmenu', onContextMenu)
    return () => {
      cancel()
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('pointermove', onPointerMove)
      node.removeEventListener('pointerup', cancel)
      node.removeEventListener('pointercancel', cancel)
      node.removeEventListener('contextmenu', onContextMenu)
    }
  }
}
