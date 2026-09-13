// Stanza unwrapping: XEP-0280 carbons and XEP-0313 archive results both
// carry a XEP-0297 <forwarded> message inside a wrapper. The wrapper is
// only authentication context - whether the inner stanza may stand in
// for what it claims depends on who sent the outer one.

import { bareJid } from '$lib/utils/jid'
import { firstNsTag, firstTag } from '$lib/utils/xml'

import { NS } from '../ns'

// Context the live pipeline passes so unwrapping can authenticate the
// wrapper. Parsing standalone (tests, tooling) stays permissive.
export interface ParseContext {
  // our own bare jid. A MAM result from it is trusted without a queryid
  // match because s2s senders cannot claim our domain and c2s stamping
  // keeps same-server users from claiming our localpart either
  ownBareJid?: string | undefined
  // queryids of MAM queries currently in flight. XEP-0313 requires the
  // server to echo the queryid on every result
  mamQueryIds?: ReadonlySet<string> | undefined
}

// CVE-2017-5858 class: a <forwarded> payload is only trustworthy inside
// the wrappers a server mints for us - carbons addressed to and from our
// own account, or a MAM result answering a query we actually sent.
// A wrapper that fails those checks marks the whole stanza untrusted:
// returning it as its own stanza would still leak the nested body and
// payload elements through the parser's descendant search.
type UnwrapResult =
  | {
      inner: Element
      kind: 'carbon-sent' | 'carbon-received' | 'mam'
      delay?: string | undefined
    }
  | 'untrusted'
  | null

export function unwrapForwarded(stanza: Element, ctx?: ParseContext): UnwrapResult {
  const ownBare = bareJid(stanza.getAttribute('to') ?? '')
  const fromBare = bareJid(stanza.getAttribute('from') ?? '')

  for (const dir of ['sent', 'received'] as const) {
    const wrapper = firstNsTag(stanza, NS.CARBONS, dir)
    if (!wrapper) continue
    const forwarded = firstNsTag(wrapper, NS.FORWARD, 'forwarded')
    const inner = forwarded ? firstTag(forwarded, 'message') : null
    // the empty-jid edge matters: to and from both absent would satisfy
    // bare equality on ''
    if (inner && forwarded && ownBare !== '' && ownBare === fromBare) {
      const delay = firstNsTag(forwarded, NS.DELAY, 'delay')?.getAttribute('stamp')
      return { inner, kind: `carbon-${dir}`, delay: delay ?? undefined }
    }
    return 'untrusted'
  }

  const result = firstNsTag(stanza, NS.MAM, 'result')
  if (!result) return null
  const forwarded = firstNsTag(result, NS.FORWARD, 'forwarded')
  const inner = forwarded ? firstTag(forwarded, 'message') : null
  if (!inner || !forwarded) return 'untrusted'
  // a forged <result> can smuggle a fabricated archive row. Trust it
  // only when its queryid answers an in-flight query (rooms) or the
  // sender is our own account (personal archive, Converse's "ignore
  // MAM chat messages not sent from yourself" fix)
  const trusted =
    ctx === undefined ||
    ctx.mamQueryIds?.has(result.getAttribute('queryid') ?? '') === true ||
    (ctx.ownBareJid !== undefined && fromBare === ctx.ownBareJid)
  if (!trusted) return 'untrusted'
  const delay = firstNsTag(forwarded, NS.DELAY, 'delay')?.getAttribute('stamp')
  return { inner, kind: 'mam', delay: delay ?? undefined }
}
