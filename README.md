# Badinage

A self-hostable web XMPP client. Connects to any existing
XMPP server over WebSocket or BOSH, supports multiple accounts at once.

## Features

- Multiple XMPP accounts, one connection each, per-account state isolation
- WebSocket and BOSH transports with automatic endpoint discovery
- Roster, presence, and direct messaging
- Customizable keyboard shortcuts with full keyboard navigation
- Offline-friendly: IndexedDB message cache plus a PWA service worker
- Dark and light themes, accessible UI, responsive layout
- packages/omemo: standalone OMEMO (XEP-0384) library

## Install

Requires Node 22+ and pnpm 11+.

```sh
pnpm install
pnpm dev
```

## Build from source

```sh
pnpm build
```

Static output lands in `dist/`, serve it with any web server.

## Docker

The production image is multi-stage, rootless, digest-pinned, and published
to `ghcr.io/quad4-software/badinage` with keyless cosign signatures.

```sh
docker run -p 8080:8080 ghcr.io/quad4-software/badinage:latest
```

Or build locally:

```sh
docker compose -f docker/compose.yaml up --build
```

The dev stack under `docker/dev/` adds a local Prosody server:

```sh
docker compose -f docker/dev/compose.yaml up
```

## Verify

```sh
pnpm check     # types + svelte diagnostics
pnpm lint      # eslint
pnpm test      # unit tests
pnpm test:e2e  # playwright, needs browsers installed
pnpm test:omemo # OMEMO library tests incl. interop vectors
```

## License

0BSD, see [LICENSE](LICENSE).
