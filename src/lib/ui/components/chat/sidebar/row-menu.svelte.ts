// Right click items for a conversation row, shared by the full sidebar
// and the compact rail. Destructive remove/leave entries sit behind a
// separator.

import {
  BookmarkX,
  CheckCheck,
  Columns2,
  Copy,
  Hash,
  LogOut,
  Search,
  Settings,
  UserMinus,
  UserPen,
  UserPlus
} from '@lucide/svelte'
import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import type { Bookmark } from '$lib/core/xmpp/connection'
import type { Account, RosterContact } from '$lib/state/accounts.svelte'
import { app } from '$lib/state/app.svelte'
import type { Conversation } from '$lib/state/chats.svelte'
import { explore } from '$lib/state/explore'
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

export function contactMenu(contact: RosterContact, account: Account | undefined): MenuItem[] {
  const items: MenuItem[] = [
    {
      id: 'copy',
      label: get(LL).copyAddress(),
      icon: Copy,
      run: () => void copyText(contact.jid)
    }
  ]
  if (account) {
    items.push(
      { id: 'sep', label: '', separator: true },
      {
        id: 'remove',
        label: get(LL).removeContact(),
        icon: UserMinus,
        danger: true,
        run: () => account.removeContact(contact.jid)
      }
    )
  }
  return items
}

export function bookmarkMenu(bookmark: Bookmark, account: Account | undefined): MenuItem[] {
  const items: MenuItem[] = [
    {
      id: 'copy',
      label: get(LL).copyAddress(),
      icon: Copy,
      run: () => void copyText(bookmark.jid)
    }
  ]
  if (account) {
    items.push(
      { id: 'sep', label: '', separator: true },
      {
        id: 'remove',
        label: get(LL).removeBookmark(),
        icon: BookmarkX,
        danger: true,
        run: () => account.removeBookmark(bookmark.jid)
      }
    )
  }
  return items
}

// the rail avatar and the account switcher share the account menu
export function accountMenu(account: Account | undefined): MenuItem[] {
  if (!account) return []
  const jid = account.jid
  const items: MenuItem[] = [
    { id: 'copy', label: get(LL).copyAddress(), icon: Copy, run: () => void copyText(jid) },
    {
      id: 'settings',
      label: get(LL).openSettings(),
      icon: Settings,
      run: () => (app.settingsOpen = true)
    }
  ]
  if (account.caps.profile) {
    items.push({
      id: 'profile',
      label: get(LL).editProfile(),
      icon: UserPen,
      run: () => (app.profileOpen = true)
    })
  }
  return items
}

// bare nav space: the actions that create conversations
export function sidebarMenu(): MenuItem[] {
  return [
    {
      id: 'add-contact',
      label: get(LL).addContact(),
      icon: UserPlus,
      run: () => (app.addContactOpen = true)
    },
    {
      id: 'join-room',
      label: get(LL).joinRoom(),
      icon: Hash,
      run: () => (app.joinRoomOpen = true)
    },
    {
      id: 'explore',
      label: get(LL).exploreRooms(),
      icon: Search,
      run: () => (explore.open = true)
    }
  ]
}
