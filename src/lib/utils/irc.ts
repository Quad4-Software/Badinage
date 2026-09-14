// IRC nickname and channel validation shared by the login form, the
// dialogs and the irc core. Kept in utils so ui components can reach
// it without importing core.

// RFC 1459 nickname grammar: a letter or special first, digits allowed
// after. Specials are the bracket/backtick/caret family.
const NICK_PATTERN = /^[a-zA-Z_[\]\\`^{|}][a-zA-Z0-9_[\]\\`^{|}-]*$/

// RFC 1459 channel grammar: # or & then a run excluding space, comma,
// colon, at sign and control bytes. An @domain suffix is accepted
// because conversations address channels as channel@domain
const CHANNEL_PATTERN = /^[#&][^\s,:@]+(@[^\s,:@]+)?$/

export function isValidIrcNick(nick: string): boolean {
  return NICK_PATTERN.test(nick)
}

export function isValidIrcChannel(input: string): boolean {
  return CHANNEL_PATTERN.test(input)
}

// the bare jid a channel input maps to. The domain is always the
// account network: a channel only exists on the server the
// connection is on, so a foreign suffix is normalized away
export function ircChannelJid(input: string, domain: string): string {
  return `${input.split('@')[0]}@${domain}`
}
