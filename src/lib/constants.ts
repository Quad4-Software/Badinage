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

// cleartext body on omemo stanzas for clients that cannot decrypt
export const OMEMO_FALLBACK_BODY =
  'I sent you an OMEMO encrypted message but your client does not support it.'
