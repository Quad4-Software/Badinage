# XEP implementation matrix

Status: done | partial | planned | deferred

| XEP           | Name                       | Status   | Notes                                                        |
| ------------- | -------------------------- | -------- | ------------------------------------------------------------ |
| RFC 6120/6121 | Core, roster, presence     | partial  | connect, roster fetch, presence broadcast                    |
| RFC 7395      | WebSocket transport        | done     | via strophe.js                                               |
| XEP-0124/0206 | BOSH                       | partial  | supported via strophe.js, untested                           |
| XEP-0156      | Alt connection discovery   | partial  | host-meta XML fetch                                          |
| XEP-0487      | host-meta.json             | partial  | discovery.ts reads JRD first                                 |
| XEP-0030      | Service discovery          | planned  | needed by upload, MUC, OMEMO                                 |
| XEP-0115      | Entity capabilities        | planned  | publish own caps hash                                        |
| XEP-0004      | Data forms                 | planned  | MUC config, registration                                     |
| XEP-0045      | Multi-user chat            | partial  | join/leave, occupants, roles, subject; invites + config open |
| XEP-0050      | Ad-hoc commands            | deferred |                                                              |
| XEP-0054      | vCard                      | planned  | avatars via vCard4 + PEP                                     |
| XEP-0059      | Result set management      | partial  | max/before in MAM queries, fin parsing                       |
| XEP-0066      | Out of band data           | planned  | URL in messages                                              |
| XEP-0077      | In-band registration       | planned  | account creation on the login screen                         |
| XEP-0085      | Chat states                | partial  | composing/paused sent for DMs, all states parsed             |
| XEP-0153      | vCard avatars              | planned  |                                                              |
| XEP-0184      | Message receipts           | done     | request on send, auto-answer, delivery ticks                 |
| XEP-0191      | Blocking                   | planned  |                                                              |
| XEP-0198      | Stream management          | planned  | session resume, ack tracking                                 |
| XEP-0199      | Ping                       | planned  | keepalive + latency display                                  |
| XEP-0203      | Delayed delivery           | done     | parsed on live, carbon and MAM paths                         |
| XEP-0245      | /me command                | planned  |                                                              |
| XEP-0249      | Direct MUC invitations     | planned  |                                                              |
| XEP-0280      | Message carbons            | done     | enabled on connect, sent/received unwrapped                  |
| XEP-0297      | Stanza forwarding          | done     | used by carbons and MAM                                      |
| XEP-0308      | Message correction         | planned  |                                                              |
| XEP-0313      | Message archive management | partial  | fetched per conversation on open, RSM paging                 |
| XEP-0333      | Chat markers               | done     | displayed sent on view, all three parsed                     |
| XEP-0352      | Client state indication    | planned  | mobile tab backgrounding                                     |
| XEP-0357      | Push notifications         | deferred | needs app server                                             |
| XEP-0359      | Stanza IDs                 | done     | stanza-id/origin-id dedup in chat store                      |
| XEP-0363      | HTTP file upload           | planned  | slot request + PUT, Cookie gotcha documented                 |
| XEP-0382      | Spoilers                   | planned  |                                                              |
| XEP-0384      | OMEMO                      | library  | own impl in packages/omemo, interop vectors vs python-omemo  |
| XEP-0385      | Stateless IM               | deferred |                                                              |
| XEP-0388      | SASL2                      | deferred | strophe.js lacks support                                     |
| XEP-0393      | Message styling            | planned  |                                                              |
| XEP-0402      | PEP bookmarks              | planned  | replaces XEP-0048                                            |
| XEP-0420      | Stanza content encryption  | library  | SCE envelope in packages/omemo                               |
| XEP-0421      | Occupant IDs               | planned  | required for MUC OMEMO                                       |
| XEP-0424      | Message retraction         | planned  |                                                              |
| XEP-0425      | Message moderation         | planned  | MUC moderator removal                                        |
| XEP-0444      | Reactions                  | planned  |                                                              |
| XEP-0454      | OMEMO media sharing        | planned  | aesgcm URLs                                                  |
| XEP-0461      | Replies                    | planned  |                                                              |
| XEP-0484      | FAST auth                  | deferred | needs SASL2 first                                            |
