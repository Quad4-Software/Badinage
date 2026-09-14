// IRC wire format (RFC 1459 + IRCv3 message tags): one text line per
// message, "@tags :prefix COMMAND param param :trailing". Parsing and
// serialization are pure so they unit test without a socket.

export interface IrcLine {
  tags: Record<string, string | undefined>
  // nick!user@host for user traffic, server name for server traffic,
  // absent for server-initiated commands like PING
  prefix?: string | undefined
  // uppercased command or numeric
  command: string
  params: string[]
  // convenience alias of the last param (trailing is still in params)
  text: string
}

// message-tag escaping applies to values only
const TAG_ESCAPES: Record<string, string> = {
  ';': '\\:',
  ' ': '\\s',
  '\\': '\\\\',
  '\r': '\\r',
  '\n': '\\n'
}

function escapeTag(value: string): string {
  return value.replace(/[; \\\r\n]/g, (c) => TAG_ESCAPES[c] ?? c)
}

function unescapeTag(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => {
    switch (c) {
      case ':':
        return ';'
      case 's':
        return ' '
      case '\\':
        return '\\'
      case 'r':
        return '\r'
      case 'n':
        return '\n'
      default:
        return c
    }
  })
}

// parse one raw line (no CRLF). Returns null for empty input.
export function parseLine(raw: string): IrcLine | null {
  if (!raw) return null
  let rest = raw
  const tags: Record<string, string | undefined> = {}
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ')
    if (space === -1) return null
    for (const part of rest.slice(1, space).split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) tags[part] = undefined
      else tags[part.slice(0, eq)] = unescapeTag(part.slice(eq + 1))
    }
    rest = rest.slice(space + 1)
  }
  let prefix: string | undefined
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ')
    if (space === -1) return null
    prefix = rest.slice(1, space)
    rest = rest.slice(space + 1)
  }
  const params: string[] = []
  let text = ''
  while (rest.length > 0) {
    if (rest.startsWith(':')) {
      text = rest.slice(1)
      params.push(text)
      break
    }
    const space = rest.indexOf(' ')
    if (space === -1) {
      params.push(rest)
      break
    }
    params.push(rest.slice(0, space))
    rest = rest.slice(space + 1).replace(/^ +/, '')
  }
  const command = params.shift()
  if (!command) return null
  return { tags, prefix, command: command.toUpperCase(), params, text }
}

export function serializeLine(line: {
  tags?: Record<string, string | undefined> | undefined
  prefix?: string | undefined
  command: string
  params: string[]
}): string {
  let out = ''
  if (line.tags && Object.keys(line.tags).length > 0) {
    const parts = Object.entries(line.tags).map(([k, v]) =>
      v === undefined ? k : `${k}=${escapeTag(v)}`
    )
    out += `@${parts.join(';')} `
  }
  if (line.prefix) out += `:${line.prefix} `
  out += line.command
  line.params.forEach((param, i) => {
    const last = i === line.params.length - 1
    // trailing form when the param carries spaces or starts with :
    if (last && (param.includes(' ') || param.startsWith(':') || param === '')) {
      out += ` :${param}`
    } else {
      out += ` ${param}`
    }
  })
  return out
}

// nick part of a nick!user@host prefix. Server prefixes (no !) come
// back whole.
export function prefixNick(prefix: string | undefined): string {
  if (!prefix) return ''
  const bang = prefix.indexOf('!')
  return bang === -1 ? prefix : prefix.slice(0, bang)
}

// CASEMAPPING values from ISUPPORT 005: which folding the server uses
// for nick and channel comparison.
export type CaseMapping = 'rfc1459' | 'strict-rfc1459' | 'ascii'

const RFC1459_MAP: Record<string, string> = { '[': '{', ']': '}', '\\': '|', '~': '^' }
const STRICT_MAP: Record<string, string> = { '[': '{', ']': '}', '\\': '|' }

export function ircLower(name: string, mapping: CaseMapping = 'rfc1459'): string {
  const lower = name.toLowerCase()
  if (mapping === 'ascii') return lower
  const map = mapping === 'strict-rfc1459' ? STRICT_MAP : RFC1459_MAP
  return lower.replace(/[\]\\[~]/g, (c) => map[c] ?? c)
}

export function ircEqual(a: string, b: string, mapping: CaseMapping = 'rfc1459'): boolean {
  return ircLower(a, mapping) === ircLower(b, mapping)
}

// mIRC inline formatting control codes: \x02 bold, \x1d italic,
// \x1f underline, \x1e strikethrough, \x11 monospace, \x16 reverse,
// \x03 colors (with optional args), \x0f reset, \x04 hex colors.
// eslint-disable-next-line no-control-regex
const COLOR_RE = /\x03(\d{1,2}(,\d{1,2})?)?|\x04([0-9a-fA-F]{6}(,[0-9a-fA-F]{6})?)?/g
// eslint-disable-next-line no-control-regex
const MIRC_RE = /[\x02\x0f\x11\x16\x1d\x1e\x1f]/g

export function stripMirc(text: string): string {
  return text.replace(COLOR_RE, '').replace(MIRC_RE, '')
}

// CTCP ACTION (\x01ACTION text\x01) wrapper detection
export function ctcpAction(text: string): string | null {
  if (text.startsWith('\x01ACTION ') && text.endsWith('\x01')) {
    return text.slice(8, -1)
  }
  return null
}

// split a message body into chunks that fit a wire line. The 512 byte
// classic limit shrinks by the command, target and tag budget, so the
// payload cap stays conservative. Splits fall on code point
// boundaries, never inside a surrogate pair or grapheme modifier.
export function splitMessage(body: string, maxBytes = 400): string[] {
  const encoder = new TextEncoder()
  const out: string[] = []
  let chunk = ''
  let size = 0
  for (const char of body) {
    const bytes = encoder.encode(char).length
    if (size + bytes > maxBytes && chunk) {
      out.push(chunk)
      chunk = ''
      size = 0
    }
    chunk += char
    size += bytes
  }
  if (chunk) out.push(chunk)
  return out.length > 0 ? out : ['']
}
