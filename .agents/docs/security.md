# Security

## Threat model

Badinage is host-trusted software. Whoever serves the JS can read messages,
OMEMO or not. Self-hosting and tight CSP are the mitigations we control.

## Credential handling

- Active passwords sit in sessionStorage (per-tab, cleared on close).
- remember only extends the session to reloads of the same tab, never to
  localStorage or IndexedDB.
- Long-term secret material (OMEMO keys, FAST tokens later) must be wrapped
  with a WebCrypto key before it reaches IndexedDB.
- Conversation snapshots in IndexedDB are wrapped with the shared
  envelope in src/lib/core/storage/crypto.ts: a non-extractable
  AES-256-GCM CryptoKey per account kept in the kv store via structured
  clone. Reads fail closed (unreadable records are dropped) and
  pre-envelope plaintext records migrate on first load. Trade-off:
  without a user passphrase the wrap key lives in the same database, so
  this defeats casual inspection and offline dumps, not an attacker who
  can execute our own code. The account lock screen in TODO.md is the
  real fix.
- Untrusted device mode exists: the per-login 'public or shared device'
  checkbox sets AccountOptions.untrusted. It writes no session blob (the
  flag wins over remember), never persists conversations to IndexedDB,
  and gives OMEMO in-memory key and trust stores. Avatars and uploads
  were already memory-only. Nothing account-scoped survives logout.
- Removing an account deletes every record namespaced to its JID across
  all IndexedDB stores (deleteAccountData in state/storage.ts).
- paneforge persists pane layouts under its own paneforge: prefix in
  localStorage. The ids are constants (PANE_AUTOSAVE_IDS) so the
  wipe-all-data flow removes them alongside the badinage: keys. The
  values are layout floats only, no account data.

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
  future OMEMO WASM module), nosniff, DENY framing, no-referrer, COOP
  same-origin and CORP same-origin.
- connect-src allows wss: and https: because XMPP endpoints are
  user-supplied and XEP-0156 host-meta discovery fetches arbitrary
  domains. ws:/http: stay excluded so remote endpoints need TLS.
- style-src keeps unsafe-inline: the production bundle was audited and
  still needs it. Svelte compiles style={} bindings to style attributes,
  and paneforge injects a <style> element for the drag cursor during
  resizes. Dropping it breaks those. Revisit if the libs change.
  script-src has no unsafe-inline and the build emits no inline scripts.
- media-src allows data: because the upload fallback inlines small
  attachments as data URIs.
- Uploaded media render through blob: URLs, never injected as HTML.
- All message bodies render as text. Svelte escapes by default, never use
  @html on stanza content.
- ui/ is barred from storage globals by eslint no-restricted-globals, and
  src/lib/core/storage/namespace.test.ts scans the tree so raw
  localStorage/sessionStorage/indexedDB use outside core/storage fails CI.

## XMPP specific

- Prefer wss:// endpoints, fall back to BOSH https://.
- SCRAM-SHA-256 minimum for password auth where the server offers it.
- LDAP-backed hosts (prosody mod_auth_ldap2 and friends) only offer SASL
  PLAIN. Strophe picks it automatically when it is all the server
  advertises. PLAIN means the password reaches the server in cleartext
  inside TLS, so it must never run over ws:// or http:// transports.
- OAuth/OIDC login follows XEP-0493: the client probes OAUTHBEARER with
  an empty token, reads the authorization server discovery url from the
  RFC 7628 error document, registers dynamically per RFC 7591, runs the
  authorization code flow with PKCE and a state nonce, then connects
  with the access token pinned to the OAUTHBEARER mechanism so it can
  never be reinterpreted as a password.
- OAuth tokens and the pending-flow stash (pkce verifier, state) live in
  sessionStorage only, under the badinage namespace. Dynamic client ids
  are public app credentials and may live in localStorage.
- XEP-0198 resumption state is per-account, namespaced, and cleared on
  logout.
- MUC OMEMO is only safe in members-only non-anonymous rooms. Enforce in
  the UI when that feature lands.

## Crash reporting

- Optional, off unless VITE_SENTRY_DSN is set at build time. Any
  Sentry-envelope-compatible server works: sentry.io, GlitchTip, Bugsink.
- Every event passes through scrubEvent in src/lib/core/telemetry.ts:
  JIDs and addresses are replaced, request urls lose credentials and
  query strings, stanza- or message-shaped breadcrumbs are dropped, user
  context is never attached.
- Users can opt out at runtime (settings > crashReporting), which drops
  events in beforeSend before anything leaves the device.
- sendDefaultPii stays false. Never add keys carrying stanza XML, message
  bodies, or credentials to breadcrumbs or extras.
- The browser DSN is public by design and rate-limitable on the server.
  Do not put server-side auth tokens in env vars Vite can inline.

## Reporting and deps

- Run `pnpm audit` before releases. Dependabot covers npm, actions, and
  docker ecosystems weekly.
- Base images in docker/Dockerfile are pinned by digest. Bump them
  deliberately and record the new digest.
- packages/omemo is our own 0BSD implementation, interop-checked against
  python-omemo vectors. Never import GPL code (libomemo.js, libsignal) into
  the dependency tree.
- Known residual: pnpm audit flags extract-zip twice under
  @lhci/cli > lighthouse > puppeteer. It has no patched upstream release
  and only ever runs inside the dev-only Lighthouse CI browser download
  path, never in the shipped bundle. Re-check on every @lhci/cli bump and
  drop the residual if upstream publishes a fix.
