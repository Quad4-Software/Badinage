export const STORAGE_PREFIX = 'badinage'

// paneforge persists pane layouts to localStorage under its own
// paneforge:<id> prefix, which scopedKey cannot reach. Keep the ids
// here so the wipe-all-data flow removes them too.
export const SHELL_PANE_AUTOSAVE_ID = 'badinage-shell'
export const SPLIT_PANE_AUTOSAVE_ID = 'badinage-split'
export const PANE_AUTOSAVE_IDS = [SHELL_PANE_AUTOSAVE_ID, SPLIT_PANE_AUTOSAVE_ID]

export const IDB_NAME = 'badinage'
export const IDB_VERSION = 1

export const DEFAULT_RESOURCE = 'badinage'

// crash reports ship to this sentry-compatible endpoint unless the
// deployment overrides VITE_SENTRY_DSN at build time; setting the env to
// 'off' disables reporting entirely for that build
export const DEFAULT_TELEMETRY_DSN = 'https://a33cf09841e94ba38d1efea79bf620f5@bugs.quad4.io/3'

export const MESSAGE_PAGE_SIZE = 50

export const RECONNECT_DELAY_MS = 5_000
export const RECONNECT_DELAY_MAX_MS = 60_000

// how long a peer chat state (composing, paused) is shown before expiring
export const CHAT_STATE_TTL_MS = 15_000

// coalesce window for persisting conversation snapshots to IndexedDB
export const PERSIST_DEBOUNCE_MS = 250

// local typing notifications are throttled to this window
export const TYPING_NOTICE_MS = 4_000

// how long transient UI feedback (copied, saved) stays visible
export const COPY_FEEDBACK_MS = 2_000

// login form polls the connection status at this interval while connecting
export const LOGIN_STATUS_POLL_MS = 250

// attachments larger than this are never inlined as data uris
export const INLINE_ATTACHMENT_LIMIT = 512 * 1024

// XEP-0199 keepalive cadence: a ping only goes out when the connection
// has seen no inbound traffic for this long
export const PING_INTERVAL_MS = 60_000

// a ping unanswered for this long counts as failed
export const PING_TIMEOUT_MS = 15_000

// XEP-0198: ask the server for a stanza ack after this many unacked sends
export const SM_ACK_EVERY = 5

// escalating wait before the login button re-enables after authfail or
// error, indexed by consecutive failure count
export const AUTHFAIL_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000] as const

// abort a stalled in-band registration handshake after this long
export const REGISTER_TIMEOUT_MS = 15_000

// reaction tooltips list at most this many sender names before a
// "+N more" tail
export const REACTION_TOOLTIP_CAP = 8

// XEP-0115 caps node uri; the final public domain is still undecided so
// this stays a stable placeholder until branding settles
export const CAPS_NODE = 'https://badinage.app/caps'

// disco queries to offline or unresponsive jids give up after this long
export const DISCO_TIMEOUT_MS = 15_000

// failed disco queries are retried no sooner than this (negative cache)
export const DISCO_NEGATIVE_TTL_MS = 60_000

// decoded vcard-temp avatar payloads larger than this are dropped
export const AVATAR_MAX_BYTES = 256 * 1024

// vcard avatar fetches run at most this many in parallel; the rest queue
export const AVATAR_FETCH_CONCURRENCY = 4

// a vcard query to an unresponsive jid gives up after this long
export const AVATAR_TIMEOUT_MS = 15_000

// cleartext body on omemo stanzas for clients that cannot decrypt
export const OMEMO_FALLBACK_BODY =
  'I sent you an OMEMO encrypted message but your client does not support it.'

// at most one desktop notification per conversation inside this window
export const NOTIFICATION_COALESCE_MS = 4_000

// character cap for the notification body preview
export const NOTIFICATION_SNIPPET_CHARS = 120

// at most this many message-body hits listed in the command palette
export const SEARCH_MESSAGE_HITS = 10

// oklch hues offered for per-account badge colors; also the pool the
// jid-hash auto color picks from
export const ACCOUNT_HUES = [25, 95, 145, 180, 210, 264, 300, 340] as const

// XEP-0199 self-ping interval while joined to a room, detects ghost joins
export const MUC_SELF_PING_MS = 60_000

// auto-rejoin after a kick or a dropped session: this many attempts,
// each delayed by the base delay times two to the attempt number
export const ROOM_REJOIN_MAX_ATTEMPTS = 3
export const ROOM_REJOIN_DELAY_MS = 5_000

// omemo signed prekeys are rotated once they are older than this
export const OMEMO_SPK_ROTATE_MS = 30 * 24 * 60 * 60 * 1000

// undecryptable stanzas kept for one-shot retry per sending device
export const OMEMO_RETRY_QUEUE_MAX = 50

// XEP-0454 aesgcm media sharing: AES-256-GCM key + 12 byte IV, tag
// appended to the ciphertext, fragment is hex(iv) followed by hex(key)
export const AESGCM_KEY_BYTES = 32
export const AESGCM_IV_BYTES = 12
export const AESGCM_TAG_BYTES = 16

// XEP-0493 oauth client login: bounds on the empty-token sasl probe and
// on the http round trips to the authorization server
export const OAUTH_PROBE_TIMEOUT_MS = 15_000
export const OAUTH_HTTP_TIMEOUT_MS = 15_000
// PKCE verifier length in bytes (43 chars base64url after encoding)
export const OAUTH_PKCE_BYTES = 32
// oauth 'state' nonce length in bytes
export const OAUTH_STATE_BYTES = 16

// XEP-0224: at most one attention alert per peer inside this window
export const ATTENTION_COOLDOWN_MS = 30_000

// XEP-0301: how often composer diffs go out while a dm draft changes
export const RTT_INTERVAL_MS = 700

// XEP-0301: a received real-time buffer is dropped after this much
// silence so a stale preview never lingers
export const RTT_TTL_MS = 15_000

// XEP-0466: expired ephemeral messages are swept at this cadence
export const EPHEMERAL_SWEEP_MS = 15_000

// PWA share target endpoint the service worker intercepts
export const SHARE_TARGET_PATH = 'share-target'

// IndexedDB key the service worker drops shared payloads under
export const SHARE_INBOX_KEY = 'share-inbox'

// upper bound on the total size of files a share_target POST stashes
export const SHARE_INBOX_MAX_BYTES = 32 * 1024 * 1024

// XEP-0080 static tile preview: single tile at this zoom with a pin
export const GEOLOC_TILE_ZOOM = 15
export const GEOLOC_TILE_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

// auto-away: no keyboard or pointer input for this long flips every
// connected, non-invisible account currently 'online' to 'away'; the
// check runs on this interval
export const IDLE_AWAY_MS = 10 * 60 * 1000
export const IDLE_CHECK_MS = 30_000

// app icon url: root-relative paths 404 when the static build is served
// under a subpath, so every icon reference goes through BASE_URL
export const APP_ICON_192 = `${import.meta.env.BASE_URL}icons/icon-192.png`
