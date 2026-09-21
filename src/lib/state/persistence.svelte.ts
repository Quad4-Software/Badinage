// IndexedDB snapshots of conversation messages. Writes are debounced so
// a 50-message MAM page lands as one transaction, not fifty, and only
// the newest slice is retained so the cache stays bounded.
//
// Snapshots are wrapped with the per-account AES-GCM key from
// core/storage/crypto so a stolen IndexedDB dump yields ciphertext. As
// documented there, the wrap key lives in the same database, so this is
// a barrier against casual inspection, not a vault.
//
// Reads fail closed: a record that cannot be unwrapped (lost or rotated
// key, corrupted data) is deleted and the conversation hydrates empty
// rather than surfacing garbage. Unwrapped records predate the envelope
// and are migrated by rewriting them wrapped.

import { MESSAGE_PAGE_SIZE, PERSIST_DEBOUNCE_MS } from '$lib/constants'
import {
  decryptRecord,
  encryptRecord,
  isWrappedRecord,
  loadWrapKey
} from '$lib/core/storage/crypto'
import { idb } from '$lib/core/storage/idb'
import { scopedKey } from '$lib/core/storage/keys'
import { bareJid } from '$lib/utils/jid'

import type { NotifySetting } from '$lib/core/xmpp/stanzas'

import type { ChatMessage, Conversation, EncryptionPreference } from './conversation.svelte'

// per-conversation preferences too small to be messages: the ephemeral
// timer, the notification override and the encryption preference.
// Stored in kv unencrypted - they leak only that a conversation exists,
// which the store keys do anyway.
export interface ConversationMeta {
  ephemeral?: number | undefined
  notify?: NotifySetting | undefined
  encryption?: EncryptionPreference | undefined
}

const RETAINED_MESSAGES = MESSAGE_PAGE_SIZE * 4

export class ConversationPersistence {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  // conversations with a scheduled write, kept so flush can save them
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private pending = new Map<string, Conversation>()

  // persist=false is the untrusted-device path: the store becomes a pure
  // no-op so nothing conversation-shaped ever reaches IndexedDB.
  constructor(
    private readonly accountJid: string,
    private readonly persist = true
  ) {}

  async load(peerJid: string): Promise<ChatMessage[] | undefined> {
    if (!this.persist) return undefined
    const storageKey = this.key(peerJid)
    const raw = await idb.get<unknown>('messages', storageKey)
    if (raw === undefined) return undefined
    if (!isWrappedRecord(raw)) {
      // plaintext snapshot from before the envelope existed: keep it
      // readable, then rewrite it wrapped so later dumps hold ciphertext
      void this.rewrap(storageKey, raw)
      return raw as ChatMessage[]
    }
    const wrapKey = await this.wrapKey()
    if (wrapKey === undefined) {
      // wrapped record but no usable crypto: fail closed
      await this.drop(storageKey)
      return undefined
    }
    try {
      return await decryptRecord<ChatMessage[]>(wrapKey, raw)
    } catch {
      // corrupted record or the key it was wrapped under is gone
      await this.drop(storageKey)
      return undefined
    }
  }

  schedule(conversation: Conversation): void {
    if (!this.persist) return
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

  private metaKey(peerJid: string): string {
    return scopedKey(this.accountJid, 'meta', bareJid(peerJid))
  }

  async loadMeta(peerJid: string): Promise<ConversationMeta | undefined> {
    return idb.get<ConversationMeta>('kv', this.metaKey(peerJid)).catch(() => undefined)
  }

  saveMeta(peerJid: string, meta: ConversationMeta): void {
    if (!this.persist) return
    void idb.set('kv', this.metaKey(peerJid), meta).catch(() => undefined)
  }

  private wrapKey(): Promise<CryptoKey | undefined> {
    // no caching: if the stored key was lost mid-session the next write
    // regenerates and stores a fresh one instead of orphaning records
    return loadWrapKey(scopedKey(this.accountJid, 'msgs-wrap')).catch(() => undefined)
  }

  private async drop(storageKey: string): Promise<void> {
    await idb.del('messages', storageKey).catch((error: unknown) => {
      console.warn(
        'failed to drop unreadable message snapshot:',
        error instanceof Error ? error.message : String(error)
      )
    })
  }

  // Best-effort plaintext migration. A save that lands between our read
  // and this write can be overwritten by the older payload. The window
  // is milliseconds wide and the next scheduled save repairs it.
  private async rewrap(storageKey: string, value: unknown): Promise<void> {
    const wrapKey = await this.wrapKey()
    if (!wrapKey) return
    try {
      await idb.set('messages', storageKey, await encryptRecord(wrapKey, value))
    } catch {
      // leave the plaintext record. The next scheduled save retries
    }
  }

  private async save(conversation: Conversation): Promise<void> {
    // $state proxies cannot be structured-cloned, snapshot to plain data
    const retained = $state.snapshot(conversation.messages.slice(-RETAINED_MESSAGES))
    const wrapKey = await this.wrapKey()
    const record = wrapKey ? await encryptRecord(wrapKey, retained) : retained
    await idb.set('messages', this.key(conversation.peerJid), record)
  }
}
