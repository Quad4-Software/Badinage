---
name: xmpp
description: XMPP protocol layer conventions for this repo. Use when adding stanza handling, a new XEP feature, or touching the connection layer.
---

## Where things live

- core/xmpp/connection.ts wraps Strophe.Connection and emits typed events
- core/xmpp/ns.ts holds every XML namespace as a constant in NS
- core/xmpp/discovery.ts resolves websocket and BOSH endpoints
- One feature equals one Module folder under src/lib/core/, registered per
  Account in state/accounts.svelte.ts

## Rules

- Never spread stanza parsing across components. Parse in core/, emit
  typed events, render the parsed result.
- New namespaces go in NS, not inline strings.
- IQ handlers must call the matching callback and return true or they leak
  the handler.
- Multi-account is the default assumption. Any stanza state keyed by JID
  must be scoped per account.
- Check .agents/docs/xep-matrix.md before starting a protocol feature and
  update the status column when it lands.
