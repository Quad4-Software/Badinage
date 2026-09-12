# Architecture

## Layers

    ui (svelte)  ->  state (runes stores)  ->  core (xmpp, storage, modules)

Dependencies point inward only. core/ is DOM-free and svelte-free so it can
run in unit tests, a SharedWorker, or a future Tauri shell.

## Accounts

Account is the unit of isolation: one Strophe connection, one ModuleRegistry,
one roster, one ChatStore. AccountsStore holds the list and the active JID.
Adding multi-account later never requires refactoring because nothing is a
singleton except the store that holds the accounts.

Storage is namespaced per account via scopedKey(jid, ...) which prefixes
keys with badinage:<bare-jid>:. IndexedDB databases and sessionStorage keys
follow the same scheme.

## Modules

Module { id, init(ctx), destroy() } is the extension point. Protocol
features (carbons, MAM, MUC, OMEMO, receipts) each live in a folder under
src/lib/core/ and register as modules on the Account. init runs on first
successful connect, destroy on logout. Modules receive the Account so they
can attach stanza handlers and publish state into stores.

ModuleRegistry.initAll awaits each init in registration order. Modules must
not depend on init order of other modules; use the events emitter for
cross-module signals.

## Connection

XmppConnection wraps Strophe.Connection and emits typed events through
Emitter: status, message, presence, roster. Endpoint resolution order:

1. explicit websocketUrl or boshUrl from the login form
2. XEP-0156 host-meta / XEP-0487 host-meta.json discovery on the JID domain

Reconnect uses exponential backoff starting at RECONNECT_DELAY_MS capped at
RECONNECT_DELAY_MAX_MS. XEP-0198 stream resumption is planned, see TODO.md.

## Rendering model

Roster and conversations are $state objects inside class instances
(Account, ChatStore). Components derive view data with $derived. Long
message lists will need virtualization before real use, ConverseJS hits the
same wall and solves it the same way.

## OMEMO boundary

src/lib/core/omemo/ is the seam. libomemo.js (GPL-3.0) is the only
maintained JS implementation. Choices on the table:

- Ship it behind a dynamic import and relicense the built bundle GPL-3.0
- Implement X3DH + double ratchet + XEP-0420 SCE in-house under 0BSD, using
  libomemo-c (GPL) test vectors for interop
- Skip to MLS once the XMPP drafts land

The rest of the app treats OMEMO as an opaque Module so the decision can
change without touching UI or storage code.
