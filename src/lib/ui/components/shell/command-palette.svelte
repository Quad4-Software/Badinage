<script lang="ts">
  import {
    CircleUserRound,
    Hash,
    MessageCircle,
    MessageSquareText,
    Palette,
    PanelLeft,
    Search,
    Settings,
    User,
    UserPlus
  } from '@lucide/svelte'
  import { Command } from 'bits-ui'
  import { toggleMode } from 'mode-watcher'

  import { SEARCH_MESSAGE_HITS } from '$lib/constants'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { Dialog, DialogContent, DialogTitle } from '$lib/ui/primitives/dialog'
  import { findMessageHits } from '$lib/utils/search'

  interface PaletteItem {
    id: string
    label: string
    icon: typeof MessageCircle
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

  let query = $state('')
  const tokens = $derived(query.toLowerCase().split(/\s+/).filter(Boolean))

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

  const groups = $derived.by<PaletteGroup[]>(() => {
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
            run: close(() => app.selectPeer(c.peerJid))
          }))
      : []

    const contacts: PaletteItem[] = roster.map((c) => ({
      id: `contact:${c.jid}`,
      label: c.name || c.jid,
      detail: c.jid,
      icon: User,
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
        label: $LL.openSettings(),
        icon: Settings,
        run: close(() => (app.settingsOpen = true))
      },
      {
        id: 'action:addContact',
        label: $LL.addContact(),
        icon: UserPlus,
        run: close(() => (app.addContactOpen = true))
      },
      {
        id: 'action:joinRoom',
        label: $LL.joinRoom(),
        icon: Hash,
        run: close(() => (app.joinRoomOpen = true))
      },
      {
        id: 'action:addAccount',
        label: $LL.addAccount(),
        icon: CircleUserRound,
        run: close(() => (app.loginOpen = true))
      },
      {
        id: 'action:toggleTheme',
        label: $LL.toggleTheme(),
        keywords: `${$LL.themeLight()} ${$LL.themeDark()} ${$LL.themeSystem()}`,
        icon: Palette,
        run: close(toggleMode)
      },
      {
        id: 'action:toggleSidebar',
        label: app.sidebarCollapsed ? $LL.expandSidebar() : $LL.collapseSidebar(),
        icon: PanelLeft,
        run: close(() => app.dispatch('nav.toggleSidebar'))
      }
    ]

    const sections: PaletteItem[] = [
      { id: 'appearance', label: $LL.appearance() },
      { id: 'general', label: $LL.general() },
      { id: 'privacy', label: $LL.privacy() },
      { id: 'encryption', label: $LL.encryption() },
      { id: 'blocked', label: $LL.blockedContacts() },
      { id: 'accounts', label: $LL.accounts() },
      { id: 'keyboard', label: $LL.keyboard() },
      { id: 'danger', label: $LL.dangerZone() }
    ].map((s) => ({
      id: `settings:${s.id}`,
      label: s.label,
      keywords: `${$LL.settings()} ${s.id}`,
      icon: Settings,
      run: section(s.id)
    }))

    const switcher: PaletteItem[] =
      accounts.list.length > 1
        ? accounts.list.map((a) => ({
            id: `account:${a.jid}`,
            label: a.jid,
            icon: CircleUserRound,
            run: close(() => (accounts.activeJid = a.jid))
          }))
        : []

    return [
      { id: 'conversations', heading: $LL.conversations(), items: conversations },
      { id: 'rooms', heading: $LL.rooms(), items: rooms },
      { id: 'messages', heading: $LL.messages(), items: messages },
      { id: 'contacts', heading: $LL.contacts(), items: contacts },
      { id: 'actions', heading: $LL.paletteActions(), items: actions },
      { id: 'settings', heading: $LL.settings(), items: sections },
      { id: 'accounts', heading: $LL.accounts(), items: switcher }
    ]
  })

  // every token must hit the label or the extra text (jid, keywords).
  // label hits outrank extra hits
  function rank(item: PaletteItem): number {
    const label = item.label.toLowerCase()
    const extra = `${item.detail ?? ''} ${item.keywords ?? ''}`.toLowerCase()
    let score = 1
    for (const token of tokens) {
      if (label.includes(token)) score = 2
      else if (!extra.includes(token)) return 0
    }
    return score
  }

  const results = $derived.by<PaletteGroup[]>(() => {
    let remaining = MAX_RESULTS
    const out: PaletteGroup[] = []
    for (const group of groups) {
      const items = group.items
        .map((item) => ({ item, score: rank(item) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item)
        .slice(0, remaining)
      if (items.length > 0) out.push({ ...group, items })
      remaining -= items.length
      if (remaining <= 0) break
    }
    return out
  })

  // fresh query on every open
  $effect(() => {
    if (app.paletteOpen) query = ''
  })
</script>

<Dialog bind:open={app.paletteOpen}>
  <DialogContent class="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
    <DialogTitle class="sr-only">{$LL.palettePlaceholder()}</DialogTitle>
    <Command.Root shouldFilter={false} loop label={$LL.palettePlaceholder()}>
      <div class="flex items-center gap-2 border-b px-3">
        <Search class="text-muted-foreground size-4 shrink-0" />
        <Command.Input
          bind:value={query}
          autofocus
          placeholder={$LL.palettePlaceholder()}
          class="placeholder:text-muted-foreground flex h-11 w-full bg-transparent text-sm outline-none"
        />
      </div>
      <Command.List class="max-h-72 overflow-x-hidden overflow-y-auto p-1.5">
        <!-- the viewport registers itself with the root so the input's
          aria-controls resolves; without it the combobox violates
          aria-required-attr -->
        <Command.Viewport>
          <Command.Empty class="text-muted-foreground py-6 text-center text-sm">
            {$LL.paletteEmpty()}
          </Command.Empty>
          {#each results as group (group.id)}
            <Command.Group value={group.id}>
              <Command.GroupHeading class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                {group.heading}
              </Command.GroupHeading>
              <Command.GroupItems>
                {#each group.items as item (item.id)}
                  <Command.Item
                    value={item.id}
                    class="data-[selected]:bg-accent data-[selected]:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none"
                    onSelect={item.run}
                  >
                    <item.icon class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{item.label}</span>
                    {#if item.detail}
                      <!-- text-foreground/70 clears the 4.5:1 floor that
                        muted-foreground misses on the popover surface -->
                      <span class="text-foreground/70 max-w-[45%] truncate text-xs">
                        {item.detail}
                      </span>
                    {/if}
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>
          {/each}
        </Command.Viewport>
      </Command.List>
    </Command.Root>
  </DialogContent>
</Dialog>
