// Notification gating rules, kept pure so they are unit-testable without
// the DOM. The ui layer feeds in settings, browser permission state and
// focus info; this module only decides.

import { NOTIFICATION_SNIPPET_CHARS } from '$lib/constants'

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported'

// A stanza counts as live incoming traffic only when it is not ours, not
// a replayed archive row (mam) and not a delayed offline delivery. Both
// the desktop notifier and the aria-live announcer share this gate so
// history hydration never announces or pops anything.
export function isLiveIncoming(
  message: { delay?: number | undefined; mam?: boolean | undefined },
  outgoing: boolean
): boolean {
  return !outgoing && message.delay === undefined && message.mam !== true
}

export interface NotifyGateInput {
  // global desktop notifications toggle
  enabled: boolean
  // per-account notifications toggle
  accountEnabled: boolean
  permission: NotifyPermission
  // document.hidden at decision time
  hidden: boolean
  // the message's conversation is the active selection on this account
  conversationActive: boolean
}

// Notify only when the user opted in (globally and per account), the
// browser granted permission, and the conversation is not already in
// front of the user in a visible tab. A focused tab showing a different
// conversation still notifies.
export function shouldNotify(input: NotifyGateInput): boolean {
  if (!input.enabled || !input.accountEnabled) return false
  if (input.permission !== 'granted') return false
  return input.hidden || !input.conversationActive
}

// Burst coalescing: at most one notification per key per window.
export function coalesced(lastAt: number | undefined, now: number, windowMs: number): boolean {
  return lastAt === undefined || now - lastAt >= windowMs
}

// One-line preview for a notification body; collapses whitespace so the
// OS never renders raw newlines and trims to a bounded length.
export function snippet(body: string, max = NOTIFICATION_SNIPPET_CHARS): string {
  const clean = body.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1).trimEnd()}…`
}
