export const STORAGE_PREFIX = 'badinage'

export const IDB_NAME = 'badinage'
export const IDB_VERSION = 1

export const DEFAULT_RESOURCE = 'badinage'

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
