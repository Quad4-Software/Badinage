# AGENTS.md

Badinage is a self-hostable web XMPP client. It targets one-to-one chat and
groupchat (MUC) with OMEMO encryption, multiple simultaneous accounts, and a
static build that runs behind any web server.

License: 0BSD. Copyright Quad4 Software.

## Stack

- Svelte 5 (runes) + Vite 8 + TypeScript 5 (strict, exactOptionalPropertyTypes)
- Tailwind CSS 4 via @tailwindcss/vite, shadcn-svelte primitives on Bits UI
- strophe.js for the XMPP transport (WebSocket + BOSH, SCRAM-SHA-256)
- typesafe-i18n for localization, run `pnpm i18n` after editing locales
- pnpm 11, pinned by the packageManager field. Install is hardened in
  pnpm-workspace.yaml: minimumReleaseAge 7 days, strictDepBuilds,
  allowBuilds allowlist, blockExoticSubdeps, no hoisting
- Vitest for unit tests, Playwright + axe-core for e2e and a11y

## Commands

    pnpm install
    pnpm dev          # dev server
    pnpm build        # static build to dist/, includes PWA service worker
    pnpm check        # svelte-check, fails on warnings
    pnpm lint         # eslint, typed rules enabled
    pnpm format       # prettier write
    pnpm test         # vitest unit tests
    pnpm test:coverage # unit tests + v8 coverage thresholds
    pnpm bench        # vitest benchmarks (stanzas, omemo crypto)
    pnpm mutate       # stryker mutation testing (vitest runner, patched)
    pnpm knip         # dead files, deps, exports (must stay clean)
    pnpm test:e2e     # playwright (needs browsers installed)
    pnpm i18n         # regenerate i18n types after editing src/lib/i18n/en
    pnpm icons        # regenerate PNG icons and og card from the mark

## Layout

    src/lib/core/      framework-free code: xmpp, omemo, storage, events, modules
    src/lib/state/     Svelte runes stores (*.svelte.ts), the reactive app model
    src/lib/ui/        primitives/ (shadcn-style Bits UI wrappers), components/
    src/lib/i18n/      generated typesafe-i18n output plus locale folders
    src/lib/utils/     pure helpers, unit tested
    packages/omemo/    @quad4-software/omemo, our own 0BSD OMEMO implementation
    e2e/               playwright specs including UI measurement tests
    docker/            prod Dockerfile + nginx + compose
    docker/dev/        dev stack: vite server + local prosody
    scripts/           build-time utilities (icon generation)
    public/            favicon, icons, og card
    .agents/docs/      architecture, XEP matrix, conventions, security, ci
    .agents/skills/    repo skills: xmpp, frontend

## Architecture rules

- core/ never imports svelte, bits-ui, or anything under ui/. It must stay
  runnable in a worker and in unit tests.
- state/ may import core/ and utils/ but never DOM APIs directly.
- ui/ components read state/ stores and call core/ through them.
- Protocol features plug in through Module (src/lib/core/module.ts) and are
  registered per Account. One Account equals one XmppConnection.
- No god files. A file over ~300 lines or a folder over ~10 files needs a
  split or a subfolder.
- Shared literals live in constants.ts or core/xmpp/ns.ts. No magic strings
  for namespaces, storage keys, or timing values.
- Storage keys are namespaced per account through scopedKey() in
  core/storage/keys.ts. Never write raw localStorage keys.
- Every user-facing string goes through typesafe-i18n. No hardcoded copy in
  components.
- Interactive elements need a11y: labels, roles, focus order. svelte-check
  runs with fail-on-warnings and axe runs in e2e.

## Security rules

- Passwords live in sessionStorage at most. Long-term secrets are wrapped
  with a WebCrypto-derived key before touching IndexedDB.
- OMEMO key material is encrypted at rest and namespaced per account.
- CSP ships in docker/nginx.conf. Keep connect-src tight.
- New dependencies must be at least 7 days old (enforced by
  minimumReleaseAge). Pin exact versions.
- Never commit secrets or weaken pnpm-workspace.yaml to make CI pass.

## Known decision: OMEMO licensing

Resolved: we implement our own. libomemo.js is GPL-3.0 which conflicts with
0BSD, so OMEMO lives in packages/omemo as @quad4-software/omemo, a standalone
0BSD package built on @noble/curves and @noble/hashes. The app integrates
it through the module boundary in src/lib/core/omemo/. Never import GPL
code.

## Style

- Plain ASCII prose: no em dashes, no en dashes as punctuation, no emojis,
  no decorative arrows or other unicode ornament, no semicolons, no curly
  quotes.
- Code comments are plain text, no backticks around identifiers.
- Docs say what and why, not marketing. See the no-slop skill for the full
  ruleset applied to prose.
