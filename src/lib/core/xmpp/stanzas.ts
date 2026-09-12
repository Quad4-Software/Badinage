// Stanza parsing: pure Element -> typed event helpers. Everything here is a
// pure function over DOM Elements so it can be unit tested without Strophe.
// Uses getElementsByTagName(NS) rather than querySelector because the test
// suite runs under @xmldom/xmldom, which has no selector engine.

import { bareJid, jidResource } from '$lib/utils/jid'

import { NS } from './ns'

export interface RosterItem {
  jid: string
  name: string
  subscription: string
  ask?: string | undefined
  groups: string[]
}

export type ChatState = 'active' | 'composing' | 'paused' | 'inactive' | 'gone'
export type MarkerType = 'received' | 'displayed' | 'acknowledged'

export interface IncomingMessage {
  from: string
  to: string
  body: string
  type: 'chat' | 'groupchat'
  // the stanza's own id attribute - receipts and chat markers reference this
  id?: string | undefined
  stanzaId?: string | undefined
  originId?: string | undefined
  delay?: number | undefined
  // carbons: another device of ours sent ('sent') or received ('received')
  // this. mam: the stanza came out of an archive query. Neither means live.
  carbon?: 'sent' | 'received' | undefined
  mam?: boolean | undefined
  chatState?: ChatState | undefined
  receiptRequest?: boolean | undefined
  receiptFor?: string | undefined
  marker?: { id: string; type: MarkerType } | undefined
  nick?: string | undefined
  subject?: string | undefined
}

export interface PresenceUpdate {
  from: string
  show: string
  status: string
  type?: string | undefined
}

export interface MucOccupant {
  room: string
  nick: string
  presence: string
  affiliation: string
  role: string
  self: boolean
  codes: string[]
}

export const CHAT_STATES: ChatState[] = ['active', 'composing', 'paused', 'inactive', 'gone']

function find(el: Element, ns: string, local: string): Element | null {
  const found = el.getElementsByTagNameNS(ns, local)
  return found.length > 0 ? (found.item(0) as Element) : null
}

function findAll(el: Element, ns: string, local: string): Element[] {
  const found = el.getElementsByTagNameNS(ns, local)
  const out: Element[] = []
  for (let i = 0; i < found.length; i++) out.push(found.item(i) as Element)
  return out
}

function findText(el: Element, local: string): string | null {
  const found = el.getElementsByTagName(local)
  return found.length > 0 ? (found.item(0)?.textContent ?? null) : null
}

function firstTag(el: Element, local: string): Element | null {
  const found = el.getElementsByTagName(local)
  return found.length > 0 ? (found.item(0) as Element) : null
}

export function parseRosterItems(stanza: Element): RosterItem[] {
  const items: RosterItem[] = []
  for (const el of findAll(stanza, NS.ROSTER, 'item')) {
    items.push({
      jid: el.getAttribute('jid') ?? '',
      name: el.getAttribute('name') ?? '',
      subscription: el.getAttribute('subscription') ?? 'none',
      ask: el.getAttribute('ask') ?? undefined,
      groups: findAll(el, NS.ROSTER, 'group').map((g) => g.textContent ?? '')
    })
  }
  return items
}

// Unwrap a carbon or MAM result to the real stanza inside <forwarded>.
// Returns null when the stanza is not wrapped.
export function unwrapForwarded(stanza: Element): {
  inner: Element
  kind: 'carbon-sent' | 'carbon-received' | 'mam'
  delay?: string | undefined
} | null {
  const ownBare = bareJid(stanza.getAttribute('to') ?? '')
  const fromBare = bareJid(stanza.getAttribute('from') ?? '')

  for (const dir of ['sent', 'received'] as const) {
    const wrapper = find(stanza, NS.CARBONS, dir)
    const forwarded = wrapper ? find(wrapper, NS.FORWARD, 'forwarded') : null
    const inner = forwarded ? firstTag(forwarded, 'message') : null
    if (inner && forwarded && ownBare === fromBare) {
      const delay = find(forwarded, NS.DELAY, 'delay')?.getAttribute('stamp')
      return { inner, kind: `carbon-${dir}`, delay: delay ?? undefined }
    }
  }

  const result = find(stanza, NS.MAM, 'result')
  const forwarded = result ? find(result, NS.FORWARD, 'forwarded') : null
  const inner = forwarded ? firstTag(forwarded, 'message') : null
  if (inner && forwarded) {
    const delay = find(forwarded, NS.DELAY, 'delay')?.getAttribute('stamp')
    return { inner, kind: 'mam', delay: delay ?? undefined }
  }

  return null
}

// Parse a <message> (already unwrapped if it was a carbon or MAM result) into
// our IncomingMessage shape. Returns null when the stanza carries nothing
// actionable.
export function parseMessage(stanza: Element): IncomingMessage | null {
  const forwarded = unwrapForwarded(stanza)
  const inner = forwarded?.inner ?? stanza
  const type = inner.getAttribute('type') === 'groupchat' ? 'groupchat' : 'chat'

  const message: IncomingMessage = {
    from: inner.getAttribute('from') ?? '',
    to: inner.getAttribute('to') ?? '',
    body: '',
    type,
    id: inner.getAttribute('id') ?? undefined
  }
  if (forwarded?.kind === 'carbon-sent') message.carbon = 'sent'
  if (forwarded?.kind === 'carbon-received') message.carbon = 'received'
  if (forwarded?.kind === 'mam') message.mam = true

  const stanzaId = find(inner, NS.STANZA_IDS, 'stanza-id')?.getAttribute('id')
  if (stanzaId) message.stanzaId = stanzaId
  const originId = find(inner, NS.STANZA_IDS, 'origin-id')?.getAttribute('id')
  if (originId) message.originId = originId
  const delay =
    forwarded?.delay ?? find(inner, NS.DELAY, 'delay')?.getAttribute('stamp') ?? undefined
  if (delay) message.delay = Date.parse(delay)

  for (const state of CHAT_STATES) {
    if (find(inner, NS.CHAT_STATES, state)) {
      message.chatState = state
      break
    }
  }
  const receipt = find(inner, NS.RECEIPTS, 'received')
  if (receipt) message.receiptFor = receipt.getAttribute('id') ?? undefined
  for (const marker of ['received', 'displayed', 'acknowledged'] as const) {
    const el = find(inner, NS.MARKERS, marker)
    if (el) {
      message.marker = { id: el.getAttribute('id') ?? '', type: marker }
      break
    }
  }
  if (find(inner, NS.RECEIPTS, 'request')) {
    message.receiptRequest = true
  }

  if (type === 'groupchat') {
    message.nick = jidResource(message.from) ?? undefined
    const subject = findText(inner, 'subject')
    if (subject !== null) message.subject = subject
  }

  const body = findText(inner, 'body')
  if (body) message.body = body

  if (
    !message.body &&
    !message.chatState &&
    !message.receiptFor &&
    !message.marker &&
    message.subject === undefined
  ) {
    return null
  }
  return message
}

// Parse a <presence> stanza. Returns one of three shapes: an occupant update
// for MUC, a subscription request, or a plain presence update.
export function parsePresence(
  stanza: Element
):
  | { kind: 'occupant'; occupant: MucOccupant }
  | { kind: 'subscribe'; from: string; status: string }
  | { kind: 'presence'; presence: PresenceUpdate }
  | null {
  const from = stanza.getAttribute('from')
  if (!from) return null
  const type = stanza.getAttribute('type')

  const mucUser = find(stanza, NS.MUC_USER, 'x')
  if (mucUser) {
    const item = find(mucUser, NS.MUC_USER, 'item')
    const codes = findAll(mucUser, NS.MUC_USER, 'status').map((s) => s.getAttribute('code') ?? '')
    return {
      kind: 'occupant',
      occupant: {
        room: bareJid(from),
        nick: jidResource(from) ?? '',
        presence: type === 'unavailable' ? 'offline' : (findText(stanza, 'show') ?? 'online'),
        affiliation: item?.getAttribute('affiliation') ?? 'none',
        role: item?.getAttribute('role') ?? 'none',
        self: codes.includes('110') || codes.includes('210'),
        codes
      }
    }
  }

  if (type === 'subscribe') {
    return {
      kind: 'subscribe',
      from: bareJid(from),
      status: findText(stanza, 'status') ?? ''
    }
  }

  return {
    kind: 'presence',
    presence: {
      from: bareJid(from),
      show: type === 'unavailable' ? 'offline' : (findText(stanza, 'show') ?? 'online'),
      status: findText(stanza, 'status') ?? '',
      type: type ?? undefined
    }
  }
}
