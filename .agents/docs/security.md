# Security

## Threat model

Badinage is host-trusted software. Whoever serves the JS can read messages,
OMEMO or not. Self-hosting and tight CSP are the mitigations we control.

## Credential handling

- Active passwords sit in sessionStorage (per-tab, cleared on close).
- remember only extends the session to reloads of the same tab, never to
  localStorage or IndexedDB.
- Long-term secret material (OMEMO keys, FAST tokens later) must be wrapped
  with a key derived via WebCrypto PBKDF2 before it reaches IndexedDB.
- An untrusted-device mode is planned: no IndexedDB writes, OMEMO disabled,
  everything cleared on logout.

## Supply chain

pnpm-workspace.yaml enforces:

- minimumReleaseAge 10080 (7 days) so brand-new releases cannot install
- strictDepBuilds with an allowBuilds list so unreviewed postinstall
  scripts fail the install
- blockExoticSubdeps against injected transitive deps
- no hoisting, verifyDepsBeforeRun install
- packageManager pins pnpm 11.24.0 for Corepack

Keep it that way. Do not add configDependencies.

## Web hardening

- docker/nginx.conf ships CSP including wasm-unsafe-eval (required for the
  future OMEMO WASM module), nosniff, DENY framing, no-referrer.
- connect-src allows wss: and https: because XMPP endpoints are arbitrary.
- Uploaded media render through blob: URLs, never injected as HTML.
- All message bodies render as text. Svelte escapes by default, never use
  @html on stanza content.

## XMPP specific

- Prefer wss:// endpoints, fall back to BOSH https://.
- SCRAM-SHA-256 minimum for password auth where the server offers it.
- XEP-0198 resumption state is per-account, namespaced, and cleared on
  logout.
- MUC OMEMO is only safe in members-only non-anonymous rooms. Enforce in
  the UI when that feature lands.

## Reporting and deps

- Run `pnpm audit` before releases. Dependabot covers npm, actions, and
  docker ecosystems weekly.
- Base images in docker/Dockerfile are pinned by digest; bump them
  deliberately and record the new digest.
- packages/omemo is our own 0BSD implementation, interop-checked against
  python-omemo vectors. Never import GPL code (libomemo.js, libsignal) into
  the dependency tree.
