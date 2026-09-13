# TODO

Legend: [ ] open, [x] done. Sections are roughly in dependency order.

## Done

- [x] Repo scaffold: pnpm 11, Vite 8, Svelte 5 runes, TS strict
- [x] Tailwind 4 + shadcn-svelte primitives (avatar, alert-dialog, button,
      checkbox, dialog, input, kbd, label, scroll-area, separator, skeleton,
      sonner, switch)
- [x] Supply chain defaults in pnpm-workspace.yaml
- [x] ESLint flat config (typed) + Prettier + svelte-check
- [x] typesafe-i18n wired, en locale
- [x] Account model: one Strophe connection per account, module registry
- [x] Login form with endpoint discovery (host-meta json + xml)
- [x] Roster fetch, presence tracking, 1:1 send/receive skeleton
- [x] Responsive shell (sidebar / chat split, mobile swap)
- [x] Docker split: prod (rootless nginx, digest-pinned, OCI labels) and
      dev (vite + prosody) under docker/dev/
- [x] AGENTS.md, .agents docs + skills, LICENSE 0BSD
- [x] Settings dialog: general prefs + customizable keybindings
- [x] Global keyboard navigation via keymap registry
- [x] Crash boundary + crash view + global error toasts
- [x] Dangerous ops behind AlertDialog (remove account, wipe data)
- [x] Loading states: skeletons, spinner buttons, connection toasts
- [x] SEO/OG meta, PWA manifest, favicon + icons + og.png generator
- [x] Message caching to IndexedDB, PWA shell precache via workbox
- [x] CI: matrix builds, pinned actions, harden-runner, CodeQL advanced,
      dependency review, scorecard, docker buildx arm64 + cosign keyless
      sign + provenance attestation
- [x] UI measurement e2e: overflow, target size, z-index, focus trap
- [x] Inter variable font via fontsource
- [x] Roster push handling (iq set jabber:iq:roster)
- [x] Presence subscription flow: inbound request UI, accept/deny, add
      contact, remove contact
- [x] XEP-0280 carbons: enable on connect, sent/received unwrap, dedup
- [x] XEP-0359 stanza-id + origin-id dedup in the chat store
- [x] XEP-0203 delay stamps parsed on live, carbon and MAM paths
- [x] XEP-0085 chat states: composing/paused sent from the composer,
      typing indicator in header and sidebar
- [x] XEP-0184 receipts (request + auto-answer) and XEP-0333 displayed
      markers, delivery/read ticks on outgoing messages
- [x] XEP-0313 MAM: per-conversation archive fetch on open, RSM paging
      primitives, MUC archive query
- [x] MUC (XEP-0045): join/leave with nick, subject display, occupant
      list with roles/affiliations, room messages, unread counts
- [x] Demo mode: fake transport with contacts, rooms, history, typing
      and replies, reachable from the login screen
- [x] Pixel-art logo, favicons, PWA icons, og card (pnpm icons)
- [x] Screenshot tool (pnpm screenshot) + README demo image
- [x] Stanza parsing unit tests (carbons, MAM, MUC presence, receipts,
      replies, reactions, corrections, attachments)
- [x] XEP-0461 replies with quote block + fallback stripping, click-to-jump
- [x] XEP-0444 reactions: emoji picker, per-sender replace, retraction,
      grouped pills
- [x] XEP-0308 message correction: edit own message, edited marker
- [x] XEP-0363 HTTP upload: service discovery, slot request, PUT, data-URI
      fallback for small files, image preview and file chips
- [x] Voice messages: MediaRecorder capture (ogg/opus), waveform player
- [x] Sidebar: search, collapsible sections, circular unread badges
- [x] Resizable layout via paneforge: sidebar drag handle + split view for
      a second conversation
- [x] Composer: friendly placeholder, drafts per conversation, emoji
      picker, reply/edit context bars, attach + voice buttons
- [x] Privacy settings: typing notifications, receipts, read markers
- [x] Presence status picker (online/away/busy) in account switcher
- [x] Demo screenshot script captures light + dark variants
- [x] XEP-0198 stream management: enable, ack, resume on reconnect,
      per-account persisted SM state (strophe engine + ScopedSmStorage)
- [x] XEP-0199 ping keepalive and latency indicator
- [x] XEP-0030/0115 disco + caps, publish own identity and features
- [x] vCard4 + XEP-0153 avatars with lazy fetch, dedup and cache
- [x] XEP-0402 PEP bookmarks: fetch, publish, retract, autojoin
- [x] XEP-0077 in-band registration on the login screen
- [x] XEP-0352 client state indication, gated on the advertised stream
      feature (unadvertised nonzas are fatal on strict servers)
- [x] XEP-0424 retraction, XEP-0382 spoilers, XEP-0393 styling,
      XEP-0245 /me
- [x] Upload progress UI with cancel, OMEMO aesgcm media
- [x] Reaction edge cases: occupant-id keyed MUC reactions, raw sender
      fallback
- [x] MUC: nick changes, XEP-0249 invites, XEP-0004 room config,
      XEP-0421 occupant ids, XEP-0425 moderation, self-ping + rejoin,
      join error surface
- [x] OMEMO wired into src/lib/core/omemo: device lists + bundles via PEP
      (omemo:2 + legacy), prekey rotation, session building, trust UI,
      WebCrypto-wrapped key storage, XEP-0454 media, undecryptable
      tombstones + one-shot retry after key recovery
- [x] UX: desktop notifications with focus check, command palette +
      global search, density setting, aria-live announcements,
      keybindings
- [x] Security: session encryption envelope, login backoff on authfail,
      CSP + dependency audit, untrusted device mode
- [x] e2e hardening: CSI/SM/carbons sends gated on stream features, axe
      pass restored (landmarks, combobox aria-controls, contrast)
- [x] XEP-0493 OAuth client login: OAUTHBEARER probe, RFC 8414
      discovery, RFC 7591 dynamic registration, PKCE redirect flow,
      sessionStorage-only tokens. Covers OIDC-backed servers (PocketID,
      Keycloak) and LDAP-backed hosts via SASL PLAIN

## Decisions to make

- [ ] App resource naming and device-id scheme for OMEMO
- [ ] Whether BOSH stays a first-class transport or becomes fallback-only
- [ ] Domain and final branding for badinage (check badinage.dev/.app)

## Protocol core

- [ ] SASL2/Bind2/FAST when strophe.js or an alternative gains support
- [x] MAM paging UX: load older on scroll-to-top, RSM cursor + complete
      tracking, scroll anchor preserved while prepending

## One-to-one chat

- [ ] Link preview policy decision (privacy vs convenience)

## Groupchat (XEP-0045)

- [ ] Subject editing UI
- [ ] Mediated invites
- [x] MUC MAM history paging (shared loadOlder path)
- [ ] occupants-can-see-real-jids handling

## OMEMO (own library, packages/omemo, 0BSD)

- [x] packages/omemo: X3DH, double ratchet, protobuf wire, SCE, bundles,
      device lists, both namespaces, storage interface
- [x] Interop validation against python-omemo (reference impl) via golden
      vectors + round-trip bridge tests (test/interop, scripts/gen_vectors.py,
      scripts/py_verify.py)
- [x] Property-based tests (fast-check), RFC 5869 known-answer vectors
- [x] API docs via TypeDoc (`pnpm --filter @quad4-software/omemo docs`)
- [ ] MUC OMEMO gated on members-only + non-anonymous + occupant ids
- [x] Publish @quad4-software/omemo to GitHub Packages on omemo-v* tags
      (publish-omemo.yml workflow)

## Multi-account and sessions

- [ ] Per-account storage namespaces enforced everywhere (audit keys)
- [ ] SharedWorker transport per account for multi-tab same-account
- [ ] Account ordering, per-account notification settings, profile colors
- [ ] Account lock screen: wrap keys with a user passphrase

## UX and platform

- [ ] Message list virtualization (long history perf)
- [ ] Onboarding: server discovery hints, Tor/i2p notes for self-hosters
- [ ] PWA manifest + service worker, installable

## i18n and a11y

- [ ] Second locale to prove the pipeline, then community process
- [ ] RTL layout support
- [x] Locale-aware date/time formatting (formatTime already takes locale)
- [x] Full axe pass on all views, keyboard-only walkthrough
- [x] Screen reader announcements for incoming messages (aria-live)

## Security hardening

- [ ] Subresource integrity for anything ever loaded off-origin (policy:
      nothing off-origin by default)
- [x] CSP audit + pnpm audit/dependency review in CI
- [x] Rate-limit login attempts, backoff on authfail
- [x] Session encryption envelope so a stolen IndexedDB dump is useless

## Testing

- [x] Unit coverage for jid, storage keys, stanza parsing, stores
- [x] Connection layer: stubbed strophe suite plus a scripted fake
      WebSocket XMPP server (test/fake-xmpp-server.ts) driving real
      handshakes, drops and reconnects
- [x] fast-check property tests for the stanza/xml/jid parsers
      (src/lib/core/xmpp/stanzas.prop.test.ts, src/lib/utils/*.prop.test.ts,
      generators in test/stanza-gen/)
- [ ] Component tests once vitest svelte browser mode settles
- [x] e2e against the dev prosody container: register, roster, chat, MUC
- [x] axe e2e on every view
- [ ] Interop matrix vs prosody, ejabberd, openfire in CI later

## DevOps and release

- [ ] GitHub Actions: lint, check, test, build, e2e (pinned SHAs,
      harden-runner, see ci-security skill)
- [ ] Pin docker base images by digest, renovate/dependabot for bumps
- [ ] Signed release artifacts, SBOM generation
- [ ] Versioning + changelog policy, first tagged release
- [ ] Deployment docs: static hosting, nginx proxy to XMPP, Traefik/Caddy
      examples, env vars
- [ ] Helm chart or simple k8s manifests if wanted

## Ideas to evaluate later

- [ ] MLS (RFC 9420) once XMPP drafts settle
- [ ] Web Push (XEP-0357) with a bundled or external app server
- [ ] Tauri/Electron wrapper reusing core/ and state/
- [ ] Import/export of account data
