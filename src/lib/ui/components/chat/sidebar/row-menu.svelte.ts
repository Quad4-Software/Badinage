// Right click items for a conversation row, shared by the full sidebar
// and the compact rail. Destructive remove/leave entries sit behind a
// separator.

import { CheckCheck, Columns2, Copy, LogOut, UserMinus } from '@lucide/svelte'
import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import type { Account } from '$lib/state/accounts.svelte'
import { app } from '$lib/state/app.svelte'
import type { Conversation } from '$lib/state/chats.svelte'
import type { MenuItem } from '$lib/state/app/menus.svelte'
import { copyText } from '$lib/ui/clipboard'

export function conversationMenu(
  conversation: Conversation,
  account: Account | undefined
): MenuItem[] {
  const items: MenuItem[] = []
  if (conversation.unread > 0) {
    items.push({
      id: 'read',
      label: get(LL).markRead(),
      icon: CheckCheck,
      run: () => (conversation.unread = 0)
    })
  }
  if (conversation.peerJid !== app.splitPeer && conversation.peerJid !== app.activePeer) {
    items.push({
      id: 'split',
      label: get(LL).openInSplit(),
      icon: Columns2,
      run: () => (app.splitPeer = conversation.peerJid)
    })
  }
  items.push({
    id: 'copy',
    label: get(LL).copyAddress(),
    icon: Copy,
    run: () => void copyText(conversation.peerJid)
  })
  const tail: MenuItem[] = []
  if (conversation.kind === 'muc' && conversation.joined && account) {
    tail.push({
      id: 'leave',
      label: get(LL).leaveRoom(),
      icon: LogOut,
      danger: true,
      run: () => account.leaveRoom(conversation.peerJid, conversation.ourNick ?? '')
    })
  }
  if (conversation.kind === 'dm' && account) {
    tail.push({
      id: 'remove',
      label: get(LL).removeContact(),
      icon: UserMinus,
      danger: true,
      run: () => account.removeContact(conversation.peerJid)
    })
  }
  if (tail.length > 0) items.push({ id: 'sep', label: '', separator: true }, ...tail)
  return items
}
