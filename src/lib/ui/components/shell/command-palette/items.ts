// Command palette rows: which items exist, what they run, and how a
// query ranks them. Kept out of the .svelte file so the component stays
// under the size cap. Called inside $derived so the state reads stay
// reactive.

import {
  CircleUserRound,
  Hash,
  MessageCircle,
  MessageSquareText,
  Palette,
  PanelLeft,
  Settings,
  User,
  UserPlus
} from '@lucide/svelte'
import { toggleMode } from 'mode-watcher'
import { get } from 'svelte/store'

import { SEARCH_MESSAGE_HITS } from '$lib/constants'
import LL from '$lib/i18n/i18n-svelte'
import { accounts, type Account } from '$lib/state/accounts.svelte'
import { app } from '$lib/state/app.svelte'
import { bareJid } from '$lib/utils/jid'
import { findMessageHits } from '$lib/utils/search'

interface PaletteAvatar {
  jid: string
  account?: Account | undefined
  force?: boolean
  fallback: string
}

interface PaletteItem {
  id: string
  label: string
  icon: typeof MessageCircle
  avatar?: PaletteAvatar
  detail?: string
  keywords?: string
  run: () => void
}

interface PaletteGroup {
  id: string
  heading: string
  items: PaletteItem[]
}

const MAX_RESULTS = 40

// after selecting a message hit the list needs a frame to mount the
// conversation. Retry briefly in case async hydrate is still landing
function jumpToMessage(id: string) {
  let tries = 0
  const attempt = () => {
    const el = document.getElementById(`m-${id}`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.animate([{ backgroundColor: 'var(--accent)' }, { backgroundColor: 'transparent' }], {
        duration: 1500
      })
      return
    }
    if (tries++ < 20) requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}

// every selectable thing closes the palette first, then runs
const close = (run: () => void) => () => {
  app.paletteOpen = false
  run()
}

const section = (id: string) =>
  close(() => {
    app.pendingSettingsSection = id
    app.settingsOpen = true
  })

function groups(query: string, tokens: string[]): PaletteGroup[] {
  const t = get(LL)
  const account = accounts.active
  const store = account ? app.chatsFor(account.jid) : undefined
  const roster = account?.roster ?? []
  const names = new Map(roster.map((c) => [c.jid, c.name]))
  const labelFor = (jid: string) => names.get(jid) || jid

  const conversations: PaletteItem[] = store
    ? [...store.conversations.values()]
        .filter((c) => c.kind === 'dm' && (c.messages.length > 0 || c.peerJid === app.activePeer))
        .map((c) => ({
          id: `dm:${c.peerJid}`,
          label: labelFor(c.peerJid),
          detail: c.peerJid,
          icon: MessageCircle,
          avatar: { jid: c.peerJid, force: true, fallback: labelFor(c.peerJid).slice(0, 2) },
          run: close(() => app.selectPeer(c.peerJid))
        }))
    : []

  const rooms: PaletteItem[] = store
    ? [...store.conversations.values()]
        .filter((c) => c.kind === 'muc' && (c.joined || c.messages.length > 0))
        .map((c) => ({
          id: `room:${c.peerJid}`,
          label: c.peerJid.split('@')[0] ?? c.peerJid,
          detail: c.peerJid,
          icon: Hash,
          avatar: {
            jid: c.peerJid,
            force: true,
            fallback: `#${(c.peerJid.split('@')[0] ?? '#').slice(0, 1)}`
          },
          run: close(() => app.selectPeer(c.peerJid))
        }))
    : []

  const contacts: PaletteItem[] = roster.map((c) => ({
    id: `contact:${c.jid}`,
    label: c.name || c.jid,
    detail: c.jid,
    icon: User,
    avatar: { jid: c.jid, fallback: (c.name || c.jid).slice(0, 2) },
    run: close(() => app.selectPeer(c.jid))
  }))

  // body search over loaded conversations. The hit body rides in
  // keywords so the ranker can still verify every token matched
  const messages: PaletteItem[] =
    tokens.length > 0 && store
      ? findMessageHits([...store.conversations.values()], query, SEARCH_MESSAGE_HITS).map(
          (hit) => ({
            id: `msg:${hit.peerJid}:${hit.messageId}`,
            label: hit.snippet,
            detail: labelFor(hit.peerJid),
            keywords: hit.body,
            icon: MessageSquareText,
            avatar: { jid: hit.peerJid, force: true, fallback: labelFor(hit.peerJid).slice(0, 2) },
            run: close(() => {
              app.selectPeer(hit.peerJid)
              jumpToMessage(hit.messageId)
            })
          })
        )
      : []

  const actions: PaletteItem[] = [
    {
      id: 'action:settings',
      label: t.openSettings(),
      icon: Settings,
      run: close(() => (app.settingsOpen = true))
    },
    {
      id: 'action:addContact',
      label: t.addContact(),
      icon: UserPlus,
      run: close(() => (app.addContactOpen = true))
    },
    {
      id: 'action:joinRoom',
      label: t.joinRoom(),
      icon: Hash,
      run: close(() => (app.joinRoomOpen = true))
    },
    {
      id: 'action:addAccount',
      label: t.addAccount(),
      icon: CircleUserRound,
      run: close(() => (app.loginOpen = true))
    },
    {
      id: 'action:toggleTheme',
      label: t.toggleTheme(),
      keywords: `${t.themeLight()} ${t.themeDark()} ${t.themeSystem()}`,
      icon: Palette,
      run: close(toggleMode)
    },
    {
      id: 'action:toggleSidebar',
      label: app.sidebarCollapsed ? t.expandSidebar() : t.collapseSidebar(),
      icon: PanelLeft,
      run: close(() => app.dispatch('nav.toggleSidebar'))
    }
  ]

  const sections: PaletteItem[] = [
    { id: 'appearance', label: t.appearance() },
    { id: 'general', label: t.general() },
    { id: 'privacy', label: t.privacy() },
    { id: 'encryption', label: t.encryption() },
    { id: 'blocked', label: t.blockedContacts() },
    { id: 'accounts', label: t.accounts() },
    { id: 'keyboard', label: t.keyboard() },
    { id: 'danger', label: t.dangerZone() }
  ].map((s) => ({
    id: `settings:${s.id}`,
    label: s.label,
    keywords: `${t.settings()} ${s.id}`,
    icon: Settings,
    run: section(s.id)
  }))

  const switcher: PaletteItem[] =
    accounts.list.length > 1
      ? accounts.list.map((a) => ({
          id: `account:${a.jid}`,
          label: a.jid,
          icon: CircleUserRound,
          avatar: { jid: bareJid(a.jid), account: a, force: true, fallback: a.jid.slice(0, 2) },
          run: close(() => (accounts.activeJid = a.jid))
        }))
      : []

  return [
    { id: 'conversations', heading: t.conversations(), items: conversations },
    { id: 'rooms', heading: t.rooms(), items: rooms },
    { id: 'messages', heading: t.messages(), items: messages },
    { id: 'contacts', heading: t.contacts(), items: contacts },
    { id: 'actions', heading: t.paletteActions(), items: actions },
    { id: 'settings', heading: t.settings(), items: sections },
    { id: 'accounts', heading: t.accounts(), items: switcher }
  ]
}

// every token must hit the label or the extra text (jid, keywords).
// label hits outrank extra hits
function rank(item: PaletteItem, tokens: string[]): number {
  const label = item.label.toLowerCase()
  const extra = `${item.detail ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  let score = 1
  for (const token of tokens) {
    if (label.includes(token)) score = 2
    else if (!extra.includes(token)) return 0
  }
  return score
}

export function paletteResults(query: string): PaletteGroup[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  let remaining = MAX_RESULTS
  const out: PaletteGroup[] = []
  for (const group of groups(query, tokens)) {
    const items = group.items
      .map((item) => ({ item, score: rank(item, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item)
      .slice(0, remaining)
    if (items.length > 0) out.push({ ...group, items })
    remaining -= items.length
    if (remaining <= 0) break
  }
  return out
}
