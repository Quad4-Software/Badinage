// Interaction helpers: tactile feedback and floating panel positioning.
// navigator.vibrate is a no-op on desktops and devices without a haptic
// actuator, so callers never branch on platform.

export function tick(ms = 10): void {
  navigator.vibrate?.(ms)
}

// The caller portals the node to body so no scroll container or
// stacking context can clip it, and anchorStyle computes a fixed
// position style that flips sides when the preferred side cannot fit
// and clamps the panel inside the viewport.

export function portal(node: HTMLElement): () => void {
  document.body.appendChild(node)
  return () => node.remove()
}

export interface AnchorOptions {
  anchor: 'top' | 'bottom'
  width: number
  height: number
  // align the panel edge to the trigger's right edge (outgoing rows,
  // right-aligned action bars) instead of the left
  alignRight?: boolean
  gap?: number
}

export function anchorStyle(rect: DOMRect, opts: AnchorOptions): string {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = opts.gap ?? 4
  const spaceAbove = rect.top
  const spaceBelow = vh - rect.bottom
  let above = opts.anchor === 'top'
  if (above && spaceAbove < opts.height + gap && spaceBelow > spaceAbove) above = false
  if (!above && spaceBelow < opts.height + gap && spaceAbove > spaceBelow) above = true
  const left = Math.min(
    Math.max(8, opts.alignRight ? rect.right - opts.width : rect.left),
    Math.max(8, vw - opts.width - 8)
  )
  return above
    ? `left:${left}px;bottom:${vh - rect.top + gap}px`
    : `left:${left}px;top:${rect.bottom + gap}px`
}
