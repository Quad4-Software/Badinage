# TODO

Legend: [ ] open, [x] done. Sections are roughly in dependency order.

## Done

- [x] Repo scaffold: pnpm 11, Vite 8, Svelte 5 runes, TS strict
- [x] Tailwind 4 + shadcn-svelte primitives (avatar, alert-dialog, button,
      checkbox, dialog, input, kbd, label, scroll-area, separator, skeleton,
      sonner, switch, tooltip)
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

## Decisions to make

- [ ] App resource naming and device-id scheme for OMEMO
- [ ] Whether BOSH stays a first-class transport or becomes fallback-only
- [ ] Domain and final branding for badinage (check badinage.dev/.app)

## Protocol core

- [ ] Roster push handling (iq set jabber:iq:roster)
- [ ] Presence subscription flow (subscribe, subscribed, inbound requests UI)
- [ ] XEP-0198 stream management: enable, ack, resume on reconnect,
      per-account persisted SM state
- [ ] XEP-0280 carbons
- [ ] XEP-0359 stanza-id dedup (partially parsed already)
- [ ] XEP-0203 delay stamps on all incoming paths
- [ ] XEP-0199 ping keepalive and latency indicator
- [ ] XEP-0030/0115 disco + caps, publish own identity and features
- [ ] vCard4 + XEP-0153 avatars with cache in IndexedDB
- [ ] XEP-0402 PEP bookmarks, room and contact bookmarks UI
- [ ] XEP-0077 in-band registration on the login screen
- [ ] XEP-0352 client state indication on tab visibility change
- [ ] SASL2/Bind2/FAST when strophe.js or an alternative gains support

## One-to-one chat

- [ ] XEP-0313 MAM sync per conversation, RSM paging, IndexedDB archive
- [ ] XEP-0085 chat states in composer and header
- [ ] XEP-0184 receipts and XEP-0333 markers
- [ ] XEP-0308 correction, XEP-0424 retraction, XEP-0461 replies,
      XEP-0444 reactions, XEP-0382 spoilers, XEP-0393 styling, XEP-0245 /me
- [ ] XEP-0363 HTTP upload: slot request, PUT with progress, Cookie header
      gotcha, image preview, aesgcm later for OMEMO
- [ ] Draft persistence per conversation
- [ ] Link preview policy decision (privacy vs convenience)

## Groupchat (XEP-0045)

- [ ] Join/leave, nick management, subject, occupant list with roles
- [ ] XEP-0249 direct invites, mediated invites
- [ ] Room config via XEP-0004 data forms
- [ ] XEP-0421 occupant ids (needed for MUC OMEMO)
- [ ] XEP-0425 moderation actions (retract, kick, ban)
- [ ] MUC MAM history, occupants-can-see-real-jids handling
- [ ] Self-ping and rejoin on kick/disconnect

## OMEMO (own library, packages/omemo, 0BSD)

- [x] packages/omemo: X3DH, double ratchet, protobuf wire, SCE, bundles,
      device lists, both namespaces, storage interface
- [x] Interop validation against python-omemo (reference impl) via golden
      vectors + round-trip bridge tests (test/interop, scripts/gen_vectors.py,
      scripts/py_verify.py)
- [x] Property-based tests (fast-check), RFC 5869 known-answer vectors
- [x] API docs via TypeDoc (`pnpm --filter @quad4-software/omemo docs`)
- [ ] Wire the package into src/lib/core/omemo/ module
- [ ] Device list publish/fetch via PEP, both omemo:2 and legacy namespaces
- [ ] Bundle publish, prekey rotation, session building per device
- [ ] Trust model UI: blind trust on first use vs manual verify, key
      fingerprints, QR verification
- [ ] Per-account encrypted key storage in IndexedDB (WebCrypto-wrapped)
- [ ] MUC OMEMO gated on members-only + non-anonymous + occupant ids
- [ ] XEP-0454 encrypted media sharing
- [ ] Undecryptable message handling and key-request UX
- [x] Publish @quad4-software/omemo to GitHub Packages on omemo-v* tags
      (publish-omemo.yml workflow)

## Multi-account and sessions

- [ ] Per-account storage namespaces enforced everywhere (audit keys)
- [ ] SharedWorker transport per account for multi-tab same-account
- [ ] Account ordering, per-account notification settings, profile colors
- [ ] Account lock screen: wrap keys with a user passphrase
- [ ] Untrusted device mode: no persistent storage, OMEMO off

## UX and platform

- [ ] Message list virtualization (long history perf)
- [ ] Desktop notifications with focus check, sound toggle
- [ ] Global search across conversations
- [ ] Emoji picker, file drag-drop paste
- [ ] Settings dialog: notifications, privacy, per-account, appearance
- [ ] Onboarding: server discovery hints, Tor/i2p notes for self-hosters
- [ ] PWA manifest + service worker, installable
- [ ] Keyboard shortcuts and command palette
- [ ] Compact/comfortable density setting

## i18n and a11y

- [ ] Second locale to prove the pipeline, then community process
- [ ] RTL layout support
- [ ] Locale-aware date/time formatting (formatTime already takes locale)
- [ ] Full axe pass on all views, keyboard-only walkthrough
- [ ] Screen reader announcements for incoming messages (aria-live)

## Security hardening

- [ ] CSP audit, drop unsafe-inline for style if feasible
- [ ] Subresource integrity for anything ever loaded off-origin (policy:
      nothing off-origin by default)
- [ ] pnpm audit + dependency review in CI
- [ ] Rate-limit login attempts, backoff on authfail
- [ ] Session encryption envelope so a stolen IndexedDB dump is useless

## Testing

- [ ] Unit coverage for jid, storage keys, stanza parsing, stores
- [ ] Component tests once vitest svelte browser mode settles
- [ ] e2e against the dev prosody container: register, roster, chat, MUC
- [ ] axe e2e on every view
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
