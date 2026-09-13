import { describe, expect, it } from 'vitest'

import { promptEligible, type PromptDef } from './prompts.svelte'

const def = (over: Partial<PromptDef> = {}): PromptDef => ({
  id: 'p',
  audience: 'all',
  version: 1,
  ...over
})

describe('promptEligible', () => {
  it('shows an unseen prompt', () => {
    expect(promptEligible(def(), {}, false)).toBe(true)
    expect(promptEligible(def(), {}, true)).toBe(true)
  })

  it('hides a prompt already answered at its version', () => {
    expect(promptEligible(def(), { p: 1 }, false)).toBe(false)
    expect(promptEligible(def(), { p: 2 }, false)).toBe(false)
  })

  it('re-asks when the version bumps past the recorded answer', () => {
    expect(promptEligible(def({ version: 2 }), { p: 1 }, false)).toBe(true)
  })

  it('targets new installs only', () => {
    const d = def({ audience: 'new' })
    expect(promptEligible(d, {}, false)).toBe(true)
    expect(promptEligible(d, {}, true)).toBe(false)
  })

  it('targets existing installs only', () => {
    const d = def({ audience: 'existing' })
    expect(promptEligible(d, {}, false)).toBe(false)
    expect(promptEligible(d, {}, true)).toBe(true)
  })

  it('applies a specific gate on top of the audience', () => {
    let on = false
    const d = def({ when: () => on })
    expect(promptEligible(d, {}, false)).toBe(false)
    on = true
    expect(promptEligible(d, {}, false)).toBe(true)
    expect(promptEligible(d, { p: 1 }, false)).toBe(false)
  })
})
