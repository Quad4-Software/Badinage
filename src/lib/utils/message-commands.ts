// Composer slash-command parsing for message-level XEPs. Pure helpers so
// they can be unit tested without a component harness.

// XEP-0245: a body starting with "/me " is an action; the wire format is
// the literal text, so only the render side needs the split. Returns the
// action text, or null when the body is not an action.
export function meAction(body: string): string | null {
  if (!body.startsWith('/me ')) return null
  const action = body.slice(4)
  return action === '' ? null : action
}

// XEP-0382 composer command: "/spoiler [hint] text" hides text behind a
// spoiler with the bracketed hint, "/spoiler text" sends a hintless
// spoiler. Returns null when the body is not a spoiler command or when
// the command carries no text to send.
export function parseSpoilerCommand(body: string): { body: string; hint: string } | null {
  const match = /^\/spoiler(?:\s+|$)/.exec(body)
  if (!match) return null
  let rest = body.slice(match[0].length)
  let hint = ''
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']')
    if (close > 1) {
      hint = rest.slice(1, close)
      rest = rest.slice(close + 1).replace(/^\s+/, '')
    }
  }
  if (rest === '') return null
  return { body: rest, hint }
}

// Conversation-level slash commands (converse-style): /clear, /leave,
// /nick, /topic, /invite, /join act on the conversation or room and
// never reach the wire as a body. Message-level commands (/me, /spoiler)
// are not this parser's business; the caller passes them through.
export interface SlashCommand {
  name: string
  args: string
}

// Returns the command for input like "/nick new name", null when the
// body is not a command at all. Multi-line args are kept so /topic can
// carry a formatted subject.
export function parseSlashCommand(body: string): SlashCommand | null {
  const match = /^\/([a-zA-Z][a-zA-Z0-9-]*)(?:\s+([\s\S]*))?$/.exec(body)
  if (!match) return null
  return { name: match[1]?.toLowerCase() ?? '', args: match[2]?.trim() ?? '' }
}
