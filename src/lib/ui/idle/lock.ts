// Auto-lock watcher: when the app lock is enabled and
// settings.lockAfterMinutes is nonzero, this much idle time seals the
// profile the same way a manual lock does. Mounted once from
// App.svelte alongside watchIdleAway. Returns the cleanup.

import { IDLE_CHECK_MS } from '$lib/constants'
import { appLock } from '$lib/state/app/lock/lock.svelte'
import { settings } from '$lib/state/settings.svelte'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function watchIdleLock(): () => void {
  let lastActivity = Date.now()

  const onActivity = () => {
    lastActivity = Date.now()
  }

  const tick = () => {
    const minutes = settings.current.lockAfterMinutes
    if (!appLock.enabled || appLock.locked || minutes <= 0) return
    if (Date.now() - lastActivity >= minutes * 60_000) {
      appLock.seal()
      window.location.reload()
    }
  }

  for (const name of ACTIVITY_EVENTS) {
    window.addEventListener(name, onActivity, { passive: true })
  }
  const interval = setInterval(tick, IDLE_CHECK_MS)
  return () => {
    for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity)
    clearInterval(interval)
  }
}
