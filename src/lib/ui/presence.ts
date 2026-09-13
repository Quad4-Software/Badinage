// Presence helpers shared by the picker, the chat header and the member
// list. Lives outside state/ because it touches the i18n store.

import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'

// XMPP show values we offer. 'online' sends a bare presence, 'chat' is
// folded into it since few contacts distinguish free-to-chat.
export const PRESENCE_VALUES = ['online', 'away', 'xa', 'dnd'] as const

export function presenceLabel(show: string): string {
  const t = get(LL)
  switch (show) {
    case 'away':
      return t.away()
    case 'xa':
      return t.extendedAway()
    case 'dnd':
      return t.busy()
    case 'offline':
      return t.offline()
    default:
      return t.online()
  }
}

// presence reads as colored text, not a status dot: online is green,
// away hues are amber, busy is red and anything else stays muted. The
// presence-* tokens are deeper than the icon-bright success/warning so
// small text clears wcag aa on light surfaces
export function presenceClass(show: string): string {
  switch (show) {
    case 'away':
    case 'xa':
      return 'text-presence-away'
    case 'dnd':
      return 'text-presence-busy'
    case 'offline':
      return 'text-muted-foreground'
    default:
      return 'text-presence-online'
  }
}

// the same mapping as an avatar ring, for places where a status badge
// used to sit on the avatar corner
export function presenceRingClass(show: string): string {
  switch (show) {
    case 'away':
    case 'xa':
      return 'ring-presence-away'
    case 'dnd':
      return 'ring-presence-busy'
    case 'offline':
      return 'ring-muted-foreground/50'
    default:
      return 'ring-presence-online'
  }
}
