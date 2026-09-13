// XEP-0301 real-time text sending for the composer: while the peer
// supports it and the conversation is not encrypted, diffs of the draft
// go out at a fixed cadence. Extracted for the size gate; nothing here
// is rendered, so plain lets suffice.

import { RTT_INTERVAL_MS } from '$lib/constants'
import type { Account } from '$lib/state/accounts.svelte'
import type { Conversation, ConversationKind } from '$lib/state/chats.svelte'
import { settings } from '$lib/state/settings.svelte'
import { diffRtt } from '$lib/utils/protocol/rtt'

export interface RttDeps {
  account: () => Account | undefined
  conversation: () => Conversation | undefined
  kind: () => ConversationKind
  peer: () => string
  body: () => string
}

export function createRtt(deps: RttDeps): {
  maybeSend: () => void
  reset: () => void
  dispose: (peer: string) => void
} {
  // the last draft the peer saw and the running seq for this composed
  // message
  let rttPrev = ''
  let rttSeq = 0
  let rttTimer: ReturnType<typeof setTimeout> | undefined
  // unknown until the first probe; 'pending' while the disco#info is out
  let support: 'unknown' | 'pending' | 'yes' | 'no' = 'unknown'

  function maybeSend(): void {
    const account = deps.account()
    if (!account || deps.kind() !== 'dm') return
    if (!settings.current.sendRealTimeText) return
    if (deps.conversation()?.encrypted === true) return
    if (support === 'unknown') {
      // probe the resource we actually heard from; disco on a bare jid
      // answers with the server's account identity, not the client, so
      // without a known full jid rtt stays off
      const target = deps.conversation()?.peerFullJid
      if (!target) {
        support = 'no'
        return
      }
      support = 'pending'
      account.connection.rttSupported(target, (supported) => {
        support = supported ? 'yes' : 'no'
      })
      return
    }
    if (support !== 'yes' || rttTimer) return
    rttTimer = setTimeout(() => {
      rttTimer = undefined
      const current = deps.account()
      if (!current) return
      const body = deps.body()
      if (body === '' && rttPrev === '') return
      if (body === '') {
        // the draft was wiped without sending: end the session
        current.connection.sendRtt(deps.peer(), rttSeq++, 'cancel', [])
        rttPrev = ''
        rttSeq = 0
        return
      }
      const ops = diffRtt(rttPrev, body)
      if (ops.length === 0) return
      current.connection.sendRtt(deps.peer(), rttSeq, rttSeq === 0 ? 'new' : 'edit', ops)
      rttSeq += 1
      rttPrev = body
    }, RTT_INTERVAL_MS)
  }

  function reset(): void {
    clearTimeout(rttTimer)
    rttTimer = undefined
    if (rttSeq > 0 && support === 'yes') {
      deps.account()?.connection.sendRtt(deps.peer(), rttSeq, 'cancel', [])
    }
    rttPrev = ''
    rttSeq = 0
  }

  // switching peers or unmounting ends any live session politely; the
  // caller passes the peer the session was on since the bound peer prop
  // may already point at the new conversation
  function dispose(peer: string): void {
    clearTimeout(rttTimer)
    rttTimer = undefined
    if (rttSeq > 0 && support === 'yes') {
      deps.account()?.connection.sendRtt(peer, rttSeq, 'cancel', [])
    }
    rttPrev = ''
    rttSeq = 0
    support = 'unknown'
  }

  return { maybeSend, reset, dispose }
}
