---
name: frontend
description: Svelte 5 + Tailwind 4 + shadcn-svelte conventions for this repo. Use when building UI, adding primitives, or touching stores.
---

## Where things live

- ui/primitives/ holds shadcn-style Bits UI wrappers with index.ts barrels
- ui/components/ holds app components, one file each
- state/ holds runes stores in .svelte.ts files
- app.css holds the theme tokens, Tailwind v4 CSS-first config

## Rules

- Runes only. No export let, no legacy $: statements.
- Reactive collections use SvelteMap or SvelteSet, never plain Map or Set
  inside $state.
- Style with theme tokens (bg-background, text-muted-foreground) not raw
  colors, so dark mode works.
- New primitives come from `pnpm dlx shadcn-svelte add <name>` then trim
  to match the existing wrappers.
- Every string goes through $LL from the i18n store.
- a11y is enforced: svelte-check fails on warnings, axe runs in e2e.
