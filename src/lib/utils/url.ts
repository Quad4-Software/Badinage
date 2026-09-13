// Attachment urls come from the wire and can carry any scheme. Only these
// are safe to hand to href or src: web links, blob urls (our own uploads)
// and inline image, audio or video data. Anything else must not become a
// link.
const SAFE_PROTOCOLS = new Set(['https:', 'http:', 'blob:'])
const SAFE_DATA = /^data:(image|audio|video)\//i

// xmpp endpoint urls typed into the login form or discovered through
// host-meta are either websocket or bosh (plain https) endpoints
export function isWebSocketUrl(url: string): boolean {
  return url.startsWith('wss://') || url.startsWith('ws://')
}

export function safeUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  // root-relative and protocol-relative urls inherit the page origin or
  // scheme, so they can only ever be http(s)
  if (trimmed.startsWith('/')) return trimmed
  try {
    // the URL parser strips embedded tabs and newlines, so schemes like
    // java\tscript: cannot sneak past the protocol check
    const { protocol } = new URL(trimmed)
    if (SAFE_PROTOCOLS.has(protocol)) return trimmed
    if (protocol === 'data:' && SAFE_DATA.test(trimmed)) return trimmed
  } catch {
    // relative or malformed input never becomes a link
  }
  return null
}
