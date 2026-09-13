// Per-peer composer state: unsent drafts, reply/edit context and focus
// callbacks. Everything is keyed by account:peer so split panes and
// account switches never leak state into each other.

import { SvelteMap } from 'svelte/reactivity'

import { bareJid } from '$lib/utils/jid'

import type { ChatMessage } from './chats.svelte'

export interface ComposerContext {
  // replying to this message
  replyTo?: ChatMessage | undefined
  // editing our own message
  editing?: ChatMessage | undefined
}

export class ComposerStore {
  private contexts = new SvelteMap<string, ComposerContext>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private focusCallbacks = new Map<string, () => void>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private drafts = new Map<string, string>()
  // a focus() that lands before the composer registers its callback is
  // remembered here and replayed by registerFocus
  private pendingFocus: string | null = null

  key(accountJid: string | undefined, peer: string): string {
    return `${accountJid ?? ''}:${bareJid(peer)}`
  }

  draft(key: string): string {
    return this.drafts.get(key) ?? ''
  }

  setDraft(key: string, value: string): void {
    if (value) this.drafts.set(key, value)
    else this.drafts.delete(key)
  }

  context(key: string): ComposerContext {
    return this.contexts.get(key) ?? {}
  }

  setContext(key: string, ctx: ComposerContext): void {
    if (ctx.replyTo || ctx.editing) this.contexts.set(key, ctx)
    else this.contexts.delete(key)
  }

  clearContext(key: string): void {
    this.contexts.delete(key)
  }

  registerFocus(key: string, focus: () => void): () => void {
    this.focusCallbacks.set(key, focus)
    if (this.pendingFocus === key) {
      this.pendingFocus = null
      focus()
    }
    return () => this.focusCallbacks.delete(key)
  }

  focus(key: string): void {
    const cb = this.focusCallbacks.get(key)
    if (cb) cb()
    else this.pendingFocus = key
  }
}
