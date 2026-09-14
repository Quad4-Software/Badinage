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
- [ ] TURN strategy for calls: rely on XEP-0215 server discovery vs
      bundle a default relay in settings

## Protocol core

- [ ] SASL2/Bind2/FAST when strophe.js or an alternative gains support
- [x] MAM paging UX: load older on scroll-to-top, RSM cursor + complete
      tracking, scroll anchor preserved while prepending

## One-to-one chat

- [ ] Link preview policy decision (privacy vs convenience)
- [x] XEP-0466 ephemeral messages: per-chat timer sync, local purge
      sweep, envelope support in OMEMO
- [x] XEP-0224 attention (buzz) with per-sender rate limiting
- [x] XEP-0301 real-time text: opt-in live typing for DMs
- [x] XEP-0080 geoloc share + location card, tile previews behind a
      privacy setting

## Groupchat (XEP-0045)

- [x] XEP-0372 mention references: @nick autocomplete, mention
      highlight, feeds 0492 on-mention notifications
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
- [x] API docs via TypeDoc (`pnpm --filter @quad4-software/badinage-omemo docs`)
- [x] XEP-0450 ATM: automatic trust policy (auto-trust first-seen on
      decrypt, changed keys drop to undecided for manual verify,
      manual verify overrides), bulk verify action
- [x] XEP-0434 trust messages: sync trust decisions across own devices
- [ ] MUC OMEMO gated on members-only + non-anonymous + occupant ids
- [x] Publish @quad4-software/badinage-omemo to GitHub Packages on
      omemo-v* tags (publish-omemo.yml workflow)

## IRC (IRCv3, Ergo)

- [x] Second protocol alongside XMPP: multiple IRC and XMPP accounts
      online at once through the per-account ChatConnection boundary
- [x] core/irc: line parser, session state machine, WebSocket transport,
      CAP negotiation, SASL PLAIN, JOIN/NAMES, PRIVMSG/NOTICE, MONITOR
      presence, AWAY, CHATHISTORY, MARKREAD, nick renames, labeled
      response failures
- [x] Channel and DM mapping onto the shared jid model, ## fallback for
      bare-nick channels, casemapping helpers
- [x] Room explore via IRC LIST, channel join with keys, add-contact by
      bare nick, IRC-aware login and add-account flows
- [x] Capability flags hide XMPP-only UI on IRC accounts: no OMEMO,
      upload, profiles, subscriptions, room config or registration
- [x] Split-pane picker groups rooms and DMs with display names and
      includes joined-but-quiet channels
- [x] Fake IRC server harness plus live tests, real Ergo interop suite
      gated on ERGO_WS, dev Ergo service in docker/dev compose, CI job
- [ ] IRC OAUTHBEARER or IRCV3BEARER SASL for OIDC providers like
      Pocket ID (Ergo supports it server-side)
- [ ] IRC bouncer or always-on story for history across disconnects

## Extensions and context menus

- [x] App-wide context menu: registry in state, contextArea attachment
      per section, keyboard navigation, viewport clamping, touch
      long-press dedup, native menu kept on links, inputs and selections
- [x] Menu sections on message rows, links, attachments, the chat
      header, sidebar conversations, contacts, bookmarks, bare nav
      space, rail accounts and the account switcher; extension items
      merge per section at open time
- [x] Extension packages: manifest validation, Ed25519 signatures via
      WebCrypto, publisher trust prompts, key-change approval that
      retires stale keys, signed-to-unsigned downgrade rejection
- [x] Sandboxed workers: network/storage/code-loading intrinsics wiped,
      permission-gated api, connect-origin allowlist on proxied fetch,
      whitelisted payload scrubbing, error budget with auto-disable,
      ready timeout for hung workers
- [x] Settings extensions section: upload, install list, enable and
      disable, remove with kv purge, unsigned toggle off by default
- [ ] Extension store or curated registry for discovery
- [ ] Extension apis beyond menus/toast/storage/net: commands,
      settings pages, message decorators

## Calls (Jingle + WebRTC)

- [ ] XEP-0166 Jingle session layer: initiate/accept/terminate,
      transport-info trickle, N contents per session from the start
- [ ] XEP-0167 RTP audio/video contents, SDP <-> Jingle mapping
- [ ] XEP-0176 ICE-UDP transport + XEP-0320 DTLS-SRTP fingerprints
- [ ] XEP-0353 Jingle message initiation: propose/proceed/retract ring UX
- [ ] XEP-0215 external service discovery for STUN/TURN credentials
- [ ] Split: pure signaling module in core/ (worker/test-safe),
      RTCPeerConnection + getUserMedia glue in ui/, call store in state/
- [ ] Call UI: incoming ring dialog, mute/camera/hangup controls,
      remote video layout, mic/camera permission handling
- [ ] Screen share via getDisplayMedia: replaceTrack swap first, then a
      second video content tagged XEP-0507 (slides vs speaker) for
      simultaneous cam+screen
- [ ] Platform caveats: sharing is desktop-only (no getDisplayMedia on
      iOS/Android), screen audio is Chromium-only
- [ ] Optional: XEP-0396 JET for OMEMO-wrapped call signaling

## Multi-account and sessions

- [x] XEP-0492 chat notification settings: always/on-mention/never on
      bookmark extensions, local fallback for DMs
- [x] XEP-0490 message displayed sync across own devices (private PEP)
- [x] XEP-0186 invisibility toggle via privacy lists (note: blocks MUC
      joins while active)
- [x] XEP-0433 extended channel search: explore public rooms dialog
- [ ] Per-account storage namespaces enforced everywhere (audit keys)
- [ ] SharedWorker transport per account for multi-tab same-account
- [ ] Account ordering, per-account notification settings, profile colors
- [ ] Account lock screen: wrap keys with a user passphrase

## UX and platform

- [x] web+xmpp protocol handler + XEP-0147 URI actions (message, join,
      roster). Message drafts land in the composer, send stays manual
- [x] PWA share_target: text/links/files into a conversation picker,
      POST via service worker inbox
- [x] Badging API unread count on the installed icon
- [x] XEP-0392 consistent contact/nick colors for avatar fallbacks
- [x] Bundle splitting: sentry SDK and non-base locales lazy-load on
      first use, emoji data already lazy. Entry chunk down ~77k gzip
- [ ] Message list virtualization (long history perf)
- [ ] OMEMO decrypt in a worker: noble ops run on the main thread,
      fine per message but a large encrypted MAM page can jank
- [ ] Onboarding: server discovery hints, Tor/i2p notes for self-hosters
- [ ] PWA manifest + service worker, installable

## i18n and a11y

- [x] Locales de, es, fr, pt, zh plus a rail language picker with an
      automatic browser-detection entry. Community process still open
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
- [ ] Group calls: Jitsi Meet link-out or SFU integration vs Muji mesh
- [ ] Web Push (XEP-0357) with a bundled or external app server
- [ ] Tauri/Electron wrapper reusing core/ and state/
- [ ] Import/export of account data
