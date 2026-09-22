// One-time ask prompts. Each registered prompt has an id, an audience
// (new installs, existing installs, or everyone) and a version so a
// materially changed ask can re-prompt users who answered an earlier
// one. Answered prompts persist in settings.seenPrompts. A prompt
// resolves once and the queue moves to the next eligible one.
//
// The e2e build disables the automatic queue so specs are not blocked
// by a modal. App.svelte exposes a window hook instead so prompt
// behavior stays testable end to end.

import { globalKey } from '$lib/core/storage/keys'
import { hasPersisted } from '$lib/core/storage/session'
import { settings } from '$lib/state/settings.svelte'

export interface PromptDef {
  id: string
  // 'new' targets first-run installs, 'existing' targets installs that
  // already had a settings blob before this session, 'all' targets both
  audience: 'new' | 'existing' | 'all'
  // bump to re-ask users who already answered an earlier version
  version: number
  // optional extra gate for prompts aimed at a specific condition
  when?: () => boolean
}

// captured at module load, before anything writes settings this
// session. A persisted blob means the install ran a build before
const returningUser = hasPersisted(globalKey('settings'))

// the crash-reporting ask. Exported so the privacy toggle can mark it
// answered: an explicit switch flip is the same consent as the dialog
export const CRASH_REPORTING_PROMPT: PromptDef = {
  id: 'crash-reporting',
  audience: 'all',
  version: 1
}

// legacy installs persisted crashReporting under the old default-on
// build, before the consent ask existed. That value is not consent so
// it folds back to off and the one-time prompt decides
if (
  settings.current.crashReporting &&
  (settings.current.seenPrompts[CRASH_REPORTING_PROMPT.id] ?? 0) < CRASH_REPORTING_PROMPT.version
) {
  settings.set('crashReporting', false)
}

const PROMPTS: PromptDef[] = [CRASH_REPORTING_PROMPT]

let pending = $state<PromptDef | null>(null)

export function currentPrompt(): PromptDef | null {
  return pending
}

export function promptEligible(
  def: PromptDef,
  seen: Record<string, number>,
  existing: boolean
): boolean {
  if ((seen[def.id] ?? 0) >= def.version) return false
  if (def.audience === 'new' && existing) return false
  if (def.audience === 'existing' && !existing) return false
  return def.when?.() ?? true
}

// surfaces the first eligible prompt. Call once the shell is up
export function queuePrompts(): void {
  pending =
    PROMPTS.find((def) => promptEligible(def, settings.current.seenPrompts, returningUser)) ?? null
}

// force-shows a prompt regardless of eligibility. Used by the e2e hook
export function showPrompt(id: string): void {
  pending = PROMPTS.find((def) => def.id === id) ?? null
}

// records the answer and applies it. Every prompt teaches resolve what
// its choice means
export function resolvePrompt(accepted: boolean): void {
  const def = pending
  if (!def) return
  settings.markPromptSeen(def.id, def.version)
  pending = null
  if (def.id === 'crash-reporting') settings.set('crashReporting', accepted)
  queuePrompts()
}
