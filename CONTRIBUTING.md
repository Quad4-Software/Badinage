# Contributing

## Setup

Requires Node 22+ and pnpm 11+.

```sh
pnpm install
pnpm dev
```

## Before opening a PR

```sh
pnpm lint
pnpm check
pnpm test
pnpm test:e2e
```

If you touched `packages/omemo`, also run `pnpm test:omemo`.

## Conventions

- Svelte 5 runes, no stores. State lives in `src/lib/state/`.
- XMPP protocol code stays in `src/lib/core/` and talks Strophe only.
- OMEMO lives in `packages/omemo` and must stay dependency-free of the app.
- Commits are GPG signed.
- See `AGENTS.md` and `.agents/docs/` for architecture and style rules.
