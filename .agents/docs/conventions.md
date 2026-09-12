# Conventions

## Files and naming

- kebab-case for files and folders, PascalCase for classes and components.
- Svelte stores that use runes live in state/ and end in .svelte.ts.
- Every folder that is a unit of API gets an index.ts that re-exports the
  public surface. Import through the index, not deep paths.
- Barrel files only inside one feature boundary. No global barrel.
- A file near 300 lines or a folder over ~10 files needs a split.
- Constants go to src/lib/constants.ts (app-level) or a constants.ts inside
  the owning feature folder. No magic strings for namespaces, storage keys,
  timing, or sizes.

## TypeScript

- strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess are on. Do
  not weaken them, and do not add non-null assertions to satisfy them.
- Prefer type for object shapes (the eslint rule for interface-vs-type is
  off because Emitter needs Record-compatible shapes).
- Use `import type` for type-only imports. The consistent-type-imports rule
  enforces this.

## Svelte

- Runes only: $state, $derived, $effect, $props. No legacy export-let or
  reactive statements.
- Use SvelteMap and SvelteSet from svelte/reactivity for reactive
  collections. Plain Map inside $state does not track mutations.
- $effect must read its dependencies. A bare read like `list.length` trips
  no-unused-expressions, bind it to a `_`-prefixed variable instead.
- Components get class through `class: className` merged with cn().

## UI primitives

- shadcn-svelte style: thin wrappers over Bits UI in ui/primitives/<name>/,
  each with an index.ts. Existing set: avatar, alert-dialog, button,
  checkbox, dialog, input, kbd, label, scroll-area, separator, skeleton,
  sonner, switch, tooltip. Add new ones with `pnpm dlx shadcn-svelte add <name>`
  and then trim to match house style.
- App components live in ui/components/, flat files, one component each.
- Toasts come from the Sonner primitive: `import { toast } from
'$lib/ui/primitives/sonner'`.
- Destructive actions always go through AlertDialog confirmation. The wipe
  flow in settings is the reference.
- Style with semantic tokens (bg-card, text-muted-foreground, border,
  ring). Raw colors and hardcoded z-index values outside the z-50 overlay
  layer are not allowed.

## Keybindings

- Actions are declared in KEYBINDING_ACTIONS with a default combo in
  DEFAULT_KEYBINDINGS (state/settings.svelte.ts), labeled in the locale,
  and wired in ui/components/keyboard.svelte.
- Combos serialize as `mod+shift+k` where mod means Ctrl or Cmd. Parsing
  and matching live in utils/keymap.ts, unit tested.
- Global keys must not fire while the user is typing in an editable field,
  Escape excepted.

## Feedback and errors

- svelte:boundary wraps the app. CrashView renders the recovery UI.
  window error and unhandledrejection handlers surface async failures as
  toasts.
- Loading states use Skeleton, not spinners, in lists. Buttons use
  LoaderCircle while busy.

## i18n

- Add keys to src/lib/i18n/en/index.ts, run `pnpm i18n`, use $LL in
  components. Generated files in src/lib/i18n/ root are ignored by lint and
  prettier, do not edit them by hand.
- New locales go in src/lib/i18n/<locale>/index.ts.

## Errors

- Let errors surface at boundaries: connection events in core/, UI
  messages in components. Do not wrap every call in try/catch.
- Discovery and optional features degrade silently to empty results.

## Commits and prose

- Sentence-case commit subjects, imperative mood, say why not what.
- No em dashes, no emojis, no decorative arrows or unicode formatting in
  docs, comments, or commit messages. No semicolons in prose. Comments
  are plain text without backticks.
