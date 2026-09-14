# XEP implementation matrix

Status: done | partial | planned | deferred

| XEP           | Name                       | Status   | Notes                                                                              |
| ------------- | -------------------------- | -------- | ---------------------------------------------------------------------------------- |
| RFC 6120/6121 | Core, roster, presence     | done     | connect, roster fetch/push, presence broadcast + subscription                      |
| RFC 7395      | WebSocket transport        | done     | via strophe.js                                                                     |
| RFC 7628      | SASL OAUTHBEARER           | done     | token login for OAuth/OIDC (PocketID, Keycloak) servers                            |
| XEP-0124/0206 | BOSH                       | partial  | supported via strophe.js, untested                                                 |
| XEP-0156      | Alt connection discovery   | partial  | host-meta XML fetch                                                                |
| XEP-0487      | host-meta.json             | partial  | discovery.ts reads JRD first                                                       |
| XEP-0030      | Service discovery          | done     | disco info/items queries + answers, feature registry                               |
| XEP-0115      | Entity capabilities        | done     | caps hash published in presence, peer caps parsed                                  |
| XEP-0004      | Data forms                 | done     | MUC config form submit, registration fields                                        |
| XEP-0045      | Multi-user chat            | done     | join/leave, nick change, invites, config, moderation, rejoin                       |
| XEP-0050      | Ad-hoc commands            | deferred |                                                                                    |
| XEP-0054      | vCard                      | partial  | avatars via vCard4 + PEP. Full profile fields open                                 |
| XEP-0059      | Result set management      | partial  | max/before in MAM queries, fin parsing                                             |
| XEP-0066      | Out of band data           | done     | parsed on incoming attachments                                                     |
| XEP-0077      | In-band registration       | done     | register mode on the login screen                                                  |
| XEP-0085      | Chat states                | partial  | composing/paused sent for DMs, all states parsed                                   |
| XEP-0153      | vCard avatars              | done     | presence hash, lazy fetch, IndexedDB cache                                         |
| XEP-0184      | Message receipts           | done     | request on send, auto-answer, delivery ticks                                       |
| XEP-0191      | Blocking                   | done     | blocklist fetch, block/unblock, push sync, local filtering                         |
| XEP-0198      | Stream management          | done     | strophe engine + per-account persisted SM state                                    |
| XEP-0199      | Ping                       | done     | keepalive + latency display, MUC self-ping for rejoin                              |
| XEP-0203      | Delayed delivery           | done     | parsed on live, carbon and MAM paths                                               |
| XEP-0245      | /me command                | done     | typed as emote, styled in the message list                                         |
| XEP-0249      | Direct MUC invitations     | done     | accept/decline with reason. Mediated invites open                                  |
| XEP-0280      | Message carbons            | done     | enable gated on stream feature, sent/received unwrapped                            |
| XEP-0297      | Stanza forwarding          | done     | used by carbons and MAM                                                            |
| XEP-0308      | Message correction         | done     | edit own message, replace by id                                                    |
| XEP-0313      | Message archive management | done     | per-conversation fetch on open, RSM paging, MUC archive                            |
| XEP-0333      | Chat markers               | done     | displayed sent on view, all three parsed                                           |
| XEP-0352      | Client state indication    | done     | active/inactive on tab visibility, gated on stream feature                         |
| XEP-0357      | Push notifications         | deferred | needs app server                                                                   |
| XEP-0359      | Stanza IDs                 | done     | stanza-id/origin-id dedup in chat store                                            |
| XEP-0363      | HTTP file upload           | done     | disco + slot + PUT, progress + cancel, data-uri fallback                           |
| XEP-0382      | Spoilers                   | done     | send hint, tap-to-reveal                                                           |
| XEP-0384      | OMEMO                      | partial  | 1:1 encrypt/decrypt, PEP devices + bundles, rotation, trust UI                     |
| XEP-0385      | Stateless IM               | deferred |                                                                                    |
| XEP-0388      | SASL2                      | deferred | strophe.js lacks support                                                           |
| XEP-0393      | Message styling            | done     | bold/italic/code/quote/blocks rendered in bodies                                   |
| XEP-0402      | PEP bookmarks              | done     | fetch, publish, retract, autojoin once per session                                 |
| XEP-0420      | Stanza content encryption  | partial  | SCE envelope used for omemo2 message bodies                                        |
| XEP-0421      | Occupant IDs               | done     | parsed on presence + messages, keys MUC reactions                                  |
| XEP-0424      | Message retraction         | done     | retract own, tombstones, moderator retraction                                      |
| XEP-0425      | Message moderation         | done     | retract/kick/ban with reason dialogs                                               |
| XEP-0444      | Reactions                  | done     | picker, per-sender replace, retract, occupant-id keyed                             |
| XEP-0446      | File metadata element      | partial  | media-type/name/size/duration on attachments                                       |
| XEP-0447      | Stateless file sharing     | partial  | SIMS sources parsed as fallback, not sent                                          |
| XEP-0454      | OMEMO media sharing        | done     | aesgcm upload + decrypt                                                            |
| XEP-0461      | Replies                    | done     | quote block + fallback strip, jump                                                 |
| XEP-0484      | FAST auth                  | deferred | needs SASL2 first                                                                  |
| XEP-0493      | OAuth client login         | done     | empty-token probe, discovery, registration, PKCE, OAUTHBEARER                      |
| XEP-0147      | XMPP URI scheme            | done     | xmpp: link parsing, web+xmpp protocol handler, deep links                          |
| XEP-0080      | User location              | done     | geoloc send/receive, envelope-carrying, tile preview card                          |
| XEP-0166/0267 | Jingle / file transfer     | deferred | call signaling research done, implementation open                                  |
| XEP-0186      | Invisible command          | done     | privacy-list presence-out deny, presence picker toggle                             |
| XEP-0224      | Attention                  | done     | buzz send/receive, notification + sound, per-chat gate                             |
| XEP-0301      | In-band real time text     | partial  | send/apply ops, live preview in header, no cursor tracking                         |
| XEP-0372      | References                 | done     | mention references on MUC sends, parsed for mentions                               |
| XEP-0392      | Consistent color           | done     | avatar fallbacks and MUC nicks via HSLuv                                           |
| XEP-0433      | Channel search             | done     | explore-rooms dialog over the search service form                                  |
| XEP-0434      | Trust messages             | done     | manual decisions sync to own devices, inbound fingerprints map to observed records |
| XEP-0450      | OMEMO ATM                  | partial  | decrypt-observe trust, bulk verify. Full ATM protocol open                         |
| XEP-0466      | Ephemeral messages         | partial  | per-chat timer, stanza + envelope timers, sweep on expiry                          |
| XEP-0490      | Message display sync       | partial  | MDS publish on view, remote markers sync unread                                    |
| XEP-0492      | Chat notification settings | done     | per-chat notify overrides, bookmark notify extension                               |
