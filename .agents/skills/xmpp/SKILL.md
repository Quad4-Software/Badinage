---
name: xmpp
description: XMPP protocol layer conventions for this repo. Use when adding stanza handling, a new XEP feature, or touching the connection layer.
---

## Where things live

- core/xmpp/connection.ts wraps Strophe.Connection and emits typed events;
  it is a thin shell delegating to feature functions
- core/xmpp/types.ts holds ChatConnection, ConnectionEvents and friends
- core/xmpp/features/ has the per-XEP plumbing (messaging, presence,
  roster, mam, upload, pep, blocking, muc, handlers), free functions over
  an XmppTransport context
- core/xmpp/stanzas.ts parses Elements into typed events (pure, unit
  tested); Element traversal helpers live in utils/xml.ts
- core/xmpp/demo.ts is the fake transport behind demo mode, implementing
  the same ChatConnection; fixtures live in demo-data.ts
- core/xmpp/ns.ts holds every XML namespace as a constant in NS plus
  HOST_META_REL for discovery link relations
- core/xmpp/discovery.ts resolves websocket and BOSH endpoints
- Account-scoped features that need a lifecycle plug in through Module
  (core/module.ts), registered per Account in state/accounts.svelte.ts.
  OMEMO is the only one today

## Rules

- Never spread stanza parsing across components. Parse in stanzas.ts,
  emit typed events, render the parsed result. Parsers use
  getElementsByTagName(NS), not querySelector, so tests run under
  @xmldom/xmldom in the node vitest environment.
- New namespaces go in NS, not inline strings.
- IQ handlers must call the matching callback and return true or they leak
  the handler.
- Multi-account is the default assumption. Any stanza state keyed by JID
  must be scoped per account.
- Check .agents/docs/xep-matrix.md before starting a protocol feature and
  update the status column when it lands.
- MAM paging: queryArchive returns MamPageResult { first, last, complete }.
  Page older with before=result.first. The archive is exhausted when
  complete=true or the page carried no first. ChatStore.loadOlder owns the
  cursor per conversation.
- In MUC, replies and reactions reference the room stanza-id (stored as
  message.id), never the transient wire id. Self-echoes arrive as
  room/our-nick and are merged into the locally pushed copy by
  body+timestamp match in chats ingest.
- Room avatars come from vcard-temp PHOTO via connection.fetchAvatar,
  fetched once per session on selectPeer.

## OMEMO

- The OMEMO implementation is packages/omemo (@quad4-software/omemo, 0BSD).
  App code must only touch it through src/lib/core/omemo/index.ts.
- packages/omemo/test/interop validates against python-omemo (Syndace's
  reference stack) two ways: golden vectors in test/interop/vectors.json
  and a live bidirectional bridge in scripts/py_verify.py (JSON per stdin
  line, with ops like kex_build, kex_accept, msg_encrypt, msg_decrypt
  driving real oldmemo/twomemo/x3dh/doubleratchet objects). New wire behavior
  needs a bridge op, not just a vector. Regenerate vectors with
  packages/omemo/.venv/bin/python scripts/gen_vectors.py.
- Property tests (fast-check) live in test/property.test.ts, spec-drift
  guards in test/conformance.test.ts, malformed-input coverage in
  test/hardening.test.ts. New protocol behavior needs all of: unit,
  property, vector/conformance, hardening, and a bridge round trip.
