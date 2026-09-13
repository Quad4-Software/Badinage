import type { Attachment } from 'svelte/attachments'

const HOLD_MS = 500
const MOVE_CANCEL_PX = 10
// a contextmenu that lands right after the touch timer fired is the same
// gesture on some mobile browsers, so it is deduped within this window
const DOUBLE_FIRE_MS = 700

// Fires on touch press-and-hold and on contextmenu (desktop right click
// opens the same menu). Pointer movement past the threshold cancels the
// timer so scrolling never triggers it.
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
        navigator.vibrate?.(10)
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
      // keep the native menu on links so urls stay shareable
      if (event.target instanceof Element && event.target.closest('a')) return
      if (Date.now() - firedAt < DOUBLE_FIRE_MS) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      handler()
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
