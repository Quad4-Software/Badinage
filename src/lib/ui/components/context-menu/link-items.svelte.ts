// Shared copy/open entries for menus that target a url: links inside
// message bodies and attachments.

import { Copy, ExternalLink } from '@lucide/svelte'
import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import type { MenuItem } from '$lib/state/app/menus.svelte'
import { copyText } from '$lib/ui/clipboard'

export function linkMenuItems(href: string): MenuItem[] {
  return [
    {
      id: 'copy-link',
      label: get(LL).copyLink(),
      icon: Copy,
      run: () => void copyText(href)
    },
    {
      id: 'open-link',
      label: get(LL).openLink(),
      icon: ExternalLink,
      run: () => window.open(href, '_blank', 'noopener,noreferrer')
    }
  ]
}
