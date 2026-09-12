---
name: frontend
description: Svelte 5 + Tailwind 4 + shadcn-svelte conventions for this repo. Use when building UI, adding primitives, wiring keyboard shortcuts, or touching stores.
---

## Where things live

- ui/primitives/ holds shadcn-style Bits UI wrappers with index.ts barrels:
  avatar, alert-dialog, button, checkbox, dialog, input, kbd, label,
  scroll-area, separator, skeleton, sonner, switch, tooltip
- ui/components/ holds app components, one file each. Shared building
  blocks: avatar (initials), presence-dot, unread-badge snippet in
  chat-sidebar, emoji-picker (used by both composer and message reactions),
  voice-player, message-attachments, chat-image, message-meta, load-older
- ui/ non-component helpers live next to them: voice.svelte.ts
  (MediaRecorder wrapper), upload.ts (XEP-0363 pipeline)
- state/ holds runes stores in .svelte.ts files
- app.css holds the theme tokens, Tailwind v4 CSS-first config

## Rules

- Runes only: $state, $derived, $effect, $props. No export let, no legacy
  $: statements.
- Reactive collections use SvelteMap or SvelteSet. Plain Map or Set inside
  $state does not track mutations. For plain local caches that lint flags,
  use a Record instead.
- Style with theme tokens (bg-background, text-muted-foreground), never raw
  colors. Semantic tokens live in app.css under @theme inline.
- New primitives come from `pnpm dlx shadcn-svelte add <name>` then trim to
  match the existing wrappers.
- Every string goes through $LL from the i18n store. Add the key to
  src/lib/i18n/en/index.ts and run `pnpm i18n`.
- Destructive actions need an AlertDialog confirm. See account-switcher and
  settings-dialog for the pattern.
- Feedback: toasts via `import { toast } from '$lib/ui/primitives/sonner'`,
  skeletons while loading, LoaderCircle in busy buttons.
- Keyboard: register actions in keyboard.svelte, declare them in
  KEYBINDING_ACTIONS, never fire global shortcuts while typing in inputs.
- a11y is enforced: svelte-check fails on warnings, axe runs in e2e, and
  e2e/ui.test.ts measures target sizes, overflow and dialog z-index.
- Overflow traps: always add min-w-0 to flex children that must shrink,
  truncate long JIDs with truncate, break-all for user text like
  subscription reasons, shrink-0 on icons/badges.
- Unread badges and count chips are fixed-size circles: size-5 rounded-full
  flex items-center justify-center, never padding-shaped ovals.
- $state objects cannot be structured-cloned into IndexedDB. Call
  $state.snapshot() before idb.set.
- $state() is only legal in a variable declaration or class field
  initializer, not inside methods. Wrap object literals by declaring a
  const first.
- Resizable layouts use paneforge PaneGroup/Pane/PaneResizer with
  autoSaveId. Mount only ONE responsive layout at a time via matchMedia.
  Rendering both and hiding one leaves duplicate nodes in the DOM and
  breaks axe plus Playwright strict locators.
- Dropdown content that should match its trigger width uses
  w-(--bits-dropdown-menu-anchor-width).
- Composer reply/edit context is per peer: app.composerFor(peerJid),
  app.setComposer, app.focusComposer. Never a single global, the split
  pane shares it otherwise.
- Escape in a component must not double-fire global bindings: call
  event.stopPropagation when the component consumes it, and the global
  dispatcher in keyboard.svelte already skips Escape while a
  role=dialog element exists.
- Remote URLs from stanzas go through safeUrl in utils/url.ts before
  reaching href/src. Only https, http, blob and data image/audio pass.
- chat-image.svelte freezes animated images off-screen by painting the
  current frame into a canvas via IntersectionObserver. Use it for every
  message image, never a bare img.
- Scroll-pinned message lists: track pinned on scroll, only scroll to
  bottom while pinned, and use a fixed-height pager row (load-older) so
  state swaps never shift content. Prepending needs a scroll anchor:
  record scrollHeight before the fetch and add the delta after rows land.
- Internal non-reactive Map/Set caches in .svelte.ts files get flagged by
  svelte/prefer-svelte-reactivity. Disable the rule per line with a
  comment saying why it is intentionally plain.
