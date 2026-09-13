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
