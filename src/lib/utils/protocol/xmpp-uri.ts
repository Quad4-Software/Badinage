// RFC 5122 plus XEP-0147 parsing for xmpp: deep links. Links arrive
// untrusted (web pages, chat text, qr codes) so this module validates the
// jid, strips control characters and caps parameter sizes before any of
// it reaches the ui. Malformed input returns null rather than throwing.

import { isValidBareJid } from '$lib/utils/jid'

export interface XmppUri {
  jid: string
  // first query token, for example message, join, roster, subscribe, remove
  action: string
  params: Record<string, string>
}

// chat bodies can legitimately run long, other fields cannot
const BODY_CAP = 2000
const PARAM_CAP = 512

const WHITESPACE = /\s/

// ASCII control characters survive decodeURIComponent and could corrupt
// stanza payloads or spoof display, so they are stripped outright. A
// codepoint loop avoids a control-character regex literal
function stripControls(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code > 0x1f && code !== 0x7f) out += ch
  }
  return out
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    // a dangling or malformed percent escape makes the whole uri suspect
    return null
  }
}

export function parseXmppUri(uri: string): XmppUri | null {
  if (!/^xmpp:/i.test(uri)) return null
  let rest = uri.slice(5)
  // the // authority marker is allowed before the path jid
  if (rest.startsWith('//')) rest = rest.slice(2)

  const q = rest.indexOf('?')
  const rawJid = q === -1 ? rest : rest.slice(0, q)
  const rawQuery = q === -1 ? '' : rest.slice(q + 1)

  const decodedJid = decode(rawJid)
  if (decodedJid === null) return null
  const jid = stripControls(decodedJid)
  // whitespace cannot appear in a jid, not even percent-encoded
  if (jid === '' || WHITESPACE.test(jid) || !isValidBareJid(jid)) return null

  let action = ''
  const params: Record<string, string> = {}
  const tokens = rawQuery.split(';').filter((t) => t !== '')
  for (const [i, token] of tokens.entries()) {
    const eq = token.indexOf('=')
    if (i === 0 && eq === -1) {
      const decoded = decode(token)
      if (decoded === null) return null
      action = stripControls(decoded)
      continue
    }
    if (eq === -1) continue
    const key = decode(token.slice(0, eq))
    const value = decode(token.slice(eq + 1))
    if (key === null || value === null || key === '') continue
    const cleanKey = stripControls(key)
    if (cleanKey === '') continue
    const cap = cleanKey === 'body' ? BODY_CAP : PARAM_CAP
    params[cleanKey] = stripControls(value).slice(0, cap)
  }
  return { jid, action, params }
}
