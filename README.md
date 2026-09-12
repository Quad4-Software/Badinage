# Badinage

Web XMPP client. Self-hosted, multi-account, OMEMO planned.

## Develop

Requires Node 22+ and pnpm 11 (pinned via corepack).

    pnpm install
    pnpm dev

## Build

    pnpm build

Static output lands in dist/, serve it with any web server.

## Run with Docker

    docker compose -f docker/compose.yaml up --build

The app listens on port 8080. An optional Prosody dev server is included:

    docker compose -f docker/compose.yaml --profile xmpp up --build

## Verify

    pnpm check     # types + svelte diagnostics
    pnpm lint      # eslint
    pnpm test      # unit tests
    pnpm test:e2e  # playwright, needs browsers installed

## Layout

src/lib/core is DOM-free XMPP and storage code, src/lib/state holds the
Svelte runes stores, src/lib/ui holds components. See AGENTS.md and
.agents/docs/ for the rules.

## License

0BSD, see LICENSE.
