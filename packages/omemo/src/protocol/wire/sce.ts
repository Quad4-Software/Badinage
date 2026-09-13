// XEP-0420 Stanza Content Encryption envelope handling. The SCE envelope is
// the plaintext that gets encrypted as the OMEMO payload for omemo:2.
//
// <envelope xmlns='urn:xmpp:sce:1'>
//   <content> ...extension elements... </content>
//   <rpad>random padding</rpad>
//   <to>recipient bare jid</to>
//   <from>sender bare jid</from>
//   <time stamp='ISO 8601'/>
// </envelope>

import { NS_SCE } from '../../constants'
import { ParseError } from '../../errors'
import { randomBytes } from '../../internal/bytes'
import { childrenNamed, el, findChild, serializeXml } from '../../internal/xml'
import type { XmlElement } from '../../internal/xml'

export interface SceEnvelopeInput {
  // The extension elements inside <content>, for example a <body> carrying
  // the message text or a <store> hint.
  content: XmlElement[]
  from?: string
  to?: string
  time?: Date
  rpad?: string
}

const RPAD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export function buildSceEnvelope(input: SceEnvelopeInput): XmlElement {
  const children: XmlElement[] = [el('content', {}, input.content)]
  const rpad = input.rpad ?? randomRpad()
  if (rpad.length > 0) children.push(el('rpad', {}, [], rpad))
  if (input.to !== undefined) children.push(el('to', {}, [], input.to))
  if (input.from !== undefined) children.push(el('from', {}, [], input.from))
  if (input.time !== undefined) {
    children.push(el('time', { stamp: input.time.toISOString() }))
  }
  return el('envelope', { xmlns: NS_SCE }, children)
}

export function serializeSceEnvelope(input: SceEnvelopeInput): string {
  return serializeXml(buildSceEnvelope(input))
}

export interface ParsedSceEnvelope {
  content: XmlElement[]
  from: string | undefined
  to: string | undefined
  time: Date | undefined
}

export function parseSceEnvelope(element: XmlElement): ParsedSceEnvelope {
  if (element.name !== 'envelope') throw new ParseError('expected <envelope> root')
  if (element.attrs['xmlns'] !== NS_SCE) throw new ParseError('invalid envelope namespace')

  const contentElt = findChild(element, 'content')
  if (!contentElt) throw new ParseError('envelope missing <content>')

  let time: Date | undefined
  const timeElt = findChild(element, 'time')
  if (timeElt) {
    const stamp = timeElt.attrs['stamp']
    if (stamp === undefined) throw new ParseError('envelope <time> missing stamp')
    time = new Date(stamp)
    if (Number.isNaN(time.getTime())) throw new ParseError('envelope <time> invalid stamp')
  }

  return {
    content: contentElt.children,
    from: findChild(element, 'from')?.text,
    to: findChild(element, 'to')?.text,
    time
  }
}

function randomRpad(length = 16): string {
  const bytes = randomBytes(length)
  let out = ''
  for (const byte of bytes) out += RPAD_CHARS[byte % RPAD_CHARS.length]
  return out
}

// Convenience helper for the common case of a chat body plus optional
// extra affix-free extension elements.
export function textEnvelope(body: string, rest: XmlElement[] = []): SceEnvelopeInput {
  return { content: [el('body', {}, [], body), ...rest] }
}

export function bodyText(envelope: ParsedSceEnvelope): string | undefined {
  for (const node of envelope.content) {
    for (const child of childrenNamed(node, 'body').concat(node.name === 'body' ? [node] : [])) {
      return child.text
    }
  }
  return undefined
}
