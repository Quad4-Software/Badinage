// Auto-away watcher (converse's auto_away): after IDLE_AWAY_MS without
// input, every connected, non-invisible account currently 'online'
// flips to 'away' and the next keystroke or pointer event restores it.
// Accounts we flipped are tracked so a presence the user picked
// meanwhile is never stomped. Mounted once from App.svelte; returns the
// cleanup.

import { IDLE_AWAY_MS, IDLE_CHECK_MS } from '$lib/constants'
import { accounts, type Account } from '$lib/state/accounts.svelte'
import { settings } from '$lib/state/settings.svelte'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function watchIdleAway(): () => void {
  const autoSet = new Set<Account>()
  let lastActivity = Date.now()

  const onActivity = () => {
    for (const account of autoSet) {
      if (account.presence === 'away') account.setPresence('online')
    }
    autoSet.clear()
    lastActivity = Date.now()
  }

  const tick = () => {
    if (!settings.current.autoAway) return
    if (Date.now() - lastActivity < IDLE_AWAY_MS) return
    for (const account of accounts.list) {
      if (account.status !== 'connected') continue
      // only a plain 'online' is auto-awayed: an explicit away, dnd or
      // xa is a user choice, and invisible accounts never emit presence
      if (account.presence !== 'online' || account.invisible) continue
      account.setPresence('away')
      autoSet.add(account)
    }
  }

  for (const name of ACTIVITY_EVENTS) {
    window.addEventListener(name, onActivity, { passive: true })
  }
  const timer = setInterval(tick, IDLE_CHECK_MS)
  return () => {
    for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity)
    clearInterval(timer)
    onActivity()
  }
}
