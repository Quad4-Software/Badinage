import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Account, RosterContact } from '$lib/state/accounts.svelte'
import type { Bookmark } from '$lib/core/xmpp/connection'

// node has no web storage and the app store chain touches it at import
// time through mode-watcher, so stub before pulling the modules in
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    }
  }
}
vi.stubGlobal('localStorage', fakeStorage())
vi.stubGlobal('sessionStorage', fakeStorage())

const { app } = await import('$lib/state/app.svelte')
const { createConversation } = await import('$lib/state/conversation.svelte')
const { accountMenu, bookmarkMenu, contactMenu, conversationMenu, occupantMenu, sidebarMenu } =
  await import('../row-menu.svelte')

const calls: string[] = []
const account = {
  jid: 'me@x.example',
  caps: { profile: true },
  removeContact: (jid: string) => calls.push(`remove:${jid}`),
  removeBookmark: (jid: string) => calls.push(`unbookmark:${jid}`),
  leaveRoom: (jid: string) => calls.push(`leave:${jid}`)
} as unknown as Account

const run = (id: string, items: { id: string; run?: () => void }[]) =>
  items.find((i) => i.id === id)?.run?.()

afterEach(() => {
  calls.length = 0
  app.joinRoomOpen = false
  app.addContactOpen = false
  app.settingsOpen = false
  app.profileOpen = false
})

describe('conversationMenu', () => {
  it('marks unread conversations read from the menu', () => {
    const conv = createConversation('peer@x.example', 'dm')
    conv.unread = 3
    const items = conversationMenu(conv, undefined)
    expect(items[0]?.id).toBe('read')
    run('read', items)
    expect(conv.unread).toBe(0)
  })

  it('offers split only when the conversation is not already open', () => {
    const conv = createConversation('other@x.example', 'dm')
    const prev = app.activePeer
    app.activePeer = 'other@x.example'
    expect(conversationMenu(conv, undefined).some((i) => i.id === 'split')).toBe(false)
    app.activePeer = prev
    expect(conversationMenu(conv, undefined).some((i) => i.id === 'split')).toBe(true)
  })

  it('puts contact removal behind a separator for dms', () => {
    const conv = createConversation('peer@x.example', 'dm')
    const items = conversationMenu(conv, account)
    expect(items.some((i) => i.separator)).toBe(true)
    const remove = items.find((i) => i.id === 'remove')
    expect(remove?.danger).toBe(true)
    run('remove', items)
    expect(calls).toEqual(['remove:peer@x.example'])
  })

  it('offers leave instead of remove for joined rooms', () => {
    const conv = createConversation('room@conf.x.example', 'muc')
    conv.joined = true
    conv.ourNick = 'me'
    const items = conversationMenu(conv, account)
    expect(items.some((i) => i.id === 'remove')).toBe(false)
    run('leave', items)
    expect(calls).toEqual(['leave:room@conf.x.example'])
  })
})

describe('contactMenu', () => {
  const contact = { jid: 'pal@x.example', name: 'Pal' } as RosterContact

  it('is copy-only without an account', () => {
    const items = contactMenu(contact, undefined)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('copy')
  })

  it('adds a destructive remove with an account', () => {
    const items = contactMenu(contact, account)
    expect(items.find((i) => i.id === 'remove')?.danger).toBe(true)
    run('remove', items)
    expect(calls).toEqual(['remove:pal@x.example'])
  })
})

describe('occupantMenu', () => {
  const room = createConversation('room@conf.x.example', 'muc')
  const withJid = {
    nick: 'pal',
    jid: 'pal@x.example',
    role: 'participant',
    affiliation: 'member',
    presence: 'online',
    self: false,
    codes: [] as string[]
  }

  it('copies the real jid and offers message and add contact', () => {
    const items = occupantMenu(withJid, room, account)
    expect(items.map((i) => i.id)).toEqual(['message', 'copy', 'sep', 'add-contact'])
    run('add-contact', items)
    expect(app.addContactOpen).toBe(true)
    expect(app.pendingLink).toEqual({ kind: 'roster', jid: 'pal@x.example', name: 'pal' })
    app.pendingLink = null
  })

  it('hides real-jid actions for anonymous rooms and the self row', () => {
    const anon = { ...withJid, jid: undefined }
    const items = occupantMenu(anon, room, account)
    expect(items.map((i) => i.id)).toEqual(['copy'])
    const self = occupantMenu({ ...withJid, self: true }, room, account)
    expect(self.map((i) => i.id)).toEqual(['copy'])
  })
})

describe('bookmarkMenu', () => {
  const bookmark = { jid: 'room@conf.x.example', kind: 'conference' } as Bookmark

  it('removes the bookmark behind a separator', () => {
    const items = bookmarkMenu(bookmark, account)
    expect(items.some((i) => i.separator)).toBe(true)
    run('remove', items)
    expect(calls).toEqual(['unbookmark:room@conf.x.example'])
  })
})

describe('accountMenu', () => {
  it('is empty without an account', () => {
    expect(accountMenu(undefined)).toEqual([])
  })

  it('copies the address and opens settings and profile', () => {
    const items = accountMenu(account)
    expect(items.map((i) => i.id)).toEqual(['copy', 'settings', 'profile'])
    run('settings', items)
    expect(app.settingsOpen).toBe(true)
    run('profile', items)
    expect(app.profileOpen).toBe(true)
  })

  it('hides edit profile when the account lacks profile caps', () => {
    const plain = { ...account, caps: {} } as Account
    expect(accountMenu(plain).some((i) => i.id === 'profile')).toBe(false)
  })
})

describe('sidebarMenu', () => {
  it('opens the join room and add contact dialogs', () => {
    const items = sidebarMenu()
    expect(items.map((i) => i.id)).toEqual(['add-contact', 'join-room', 'explore'])
    run('join-room', items)
    expect(app.joinRoomOpen).toBe(true)
    run('add-contact', items)
    expect(app.addContactOpen).toBe(true)
  })
})
