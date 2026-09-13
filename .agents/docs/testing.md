# Testing

Badinage tests at several layers. Each layer exists because the one below
it cannot see the failure it catches. Pick the cheapest layer that can
observe the thing you changed.

## Layers

### Unit tests (vitest, node env)

`*.test.ts` colocated with the code. For pure logic: parsers, stores,
utils, eligibility rules. State modules (`*.svelte.ts`) run under node
because runed tolerates SSR. They cannot touch DOM APIs anyway.

### Property tests (fast-check)

`*.prop.test.ts` plus generators in `test/stanza-gen/`. For anything that
parses or serializes untrusted input: stanzas, JIDs, message styling.
A unit test asserts an example. A property test asserts the shape of
every input.

### Source-scan audits

`core/storage/namespace.test.ts` and `ui/conventions.test.ts` read the
source tree and fail on forbidden patterns: raw storage outside
core/storage, legacy `export let`, literal `aria-label`/`placeholder`/
`title` attributes, raw hex colors, `{@html`/`innerHTML`/`eval`/
`document.cookie`. When a convention can be written as a pattern, add a
scan here instead of relying on review to catch it.

### Benchmarks and mutation

`pnpm bench` for hot paths (stanza parsing, omemo crypto).
`pnpm mutate` runs stryker against the vitest suite when you want to
know whether the tests would notice a broken implementation.

### Playwright e2e

Specs live in `e2e/` and run against a production build on both the
chromium and mobile (Pixel 7, touch) projects. Layers by file:

- `smoke.test.ts` - boot, form validation, first-paint health
- `ui.test.ts` - layout invariants measured, not eyeballed: no
  horizontal overflow at 375/768/1280, 24px minimum targets, every
  control has an accessible name, dialog z-index, focus trap
- `dialogs.test.ts` - the modal contract as a matrix: every dialog is
  labelled, axe-clean and Escape-dismissable. New dialogs get a row
- `a11y.test.ts` - axe sweep per view and per state
- `demo.test.ts`, `mobile.test.ts`, `prompt.test.ts` - feature flows
- `server.test.ts` - live interop against the dev prosody container,
  skipped when it is not running

## Helpers and hooks

`e2e/helpers.ts` exports `enterDemo(page)` which signs into the bundled
demo account and settles the shell (connect toast dismissed). Use it
instead of re-rolling the login sequence.

The e2e build compiles with two env flags:

- `VITE_E2E=1` disables automatic one-time prompts so the consent modal
  does not block every spec. The prompt spec drives it through the
  `window.__badinagePrompts` hook (`show`, `resolve`, `current`) which
  App.svelte installs only under this flag.
- `VITE_SENTRY_DSN=off` keeps the build hermetic: opting in through the
  prompt never initializes the SDK or contacts a real endpoint.

## Writing specs

- Query by role and accessible name, never by class or DOM position.
- `localStorage` writes are reactive: poll with `expect.poll` instead of
  asserting once.
- One invariant per spec. A matrix row beats a bespoke spec when the
  same contract applies to many subjects.
- Prefer adding a case to an existing matrix (dialogs, measurement
  widths) over writing a parallel spec.
- Keep fixtures inside the spec or in `test/`. Do not grow e2e helper
  files beyond genuinely shared entry points like `enterDemo`.
