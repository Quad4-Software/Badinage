// IndexedDB snapshots of conversation messages. Writes are debounced so
// a 50-message MAM page lands as one transaction, not fifty, and only
// the newest slice is retained so the cache stays bounded.

import { MESSAGE_PAGE_SIZE, PERSIST_DEBOUNCE_MS } from '$lib/constants'
import { idb } from '$lib/core/storage/idb'
import { scopedKey } from '$lib/core/storage/keys'
import { bareJid } from '$lib/utils/jid'

import type { ChatMessage, Conversation } from './conversation.svelte'

const RETAINED_MESSAGES = MESSAGE_PAGE_SIZE * 4

export class ConversationPersistence {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  // conversations with a scheduled write, kept so flush can save them
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private pending = new Map<string, Conversation>()

  constructor(private readonly accountJid: string) {}

  async load(peerJid: string): Promise<ChatMessage[] | undefined> {
    return idb.get<ChatMessage[]>('messages', this.key(peerJid))
  }

  schedule(conversation: Conversation): void {
    const key = this.key(conversation.peerJid)
    this.pending.set(key, conversation)
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        const pending = this.pending.get(key)
        this.pending.delete(key)
        if (pending) void this.save(pending)
      }, PERSIST_DEBOUNCE_MS)
    )
  }

  // Write out everything still debounced. Called on disconnect and account
  // removal so the last messages of the session are not lost.
  async flush(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    const pending = [...this.pending.values()]
    this.pending.clear()
    await Promise.all(pending.map((conversation) => this.save(conversation)))
  }

  private key(peerJid: string): string {
    return scopedKey(this.accountJid, 'msgs', bareJid(peerJid))
  }

  private async save(conversation: Conversation): Promise<void> {
    // $state proxies cannot be structured-cloned, snapshot to plain data
    const retained = $state.snapshot(conversation.messages.slice(-RETAINED_MESSAGES))
    await idb.set('messages', this.key(conversation.peerJid), retained)
  }
}
