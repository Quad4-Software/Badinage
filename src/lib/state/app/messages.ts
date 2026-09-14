// The per-account incoming message pipeline: blocklist filter, OMEMO
// decrypt-then-ingest, receipt replies, and the undecryptable retry
// queue. Extracted from app.svelte.ts for the size gate. The wiring in
// bindAccount stays identical.

import { OMEMO_RETRY_QUEUE_MAX } from '$lib/constants'
import type { IncomingMessage } from '$lib/core/xmpp/stanzas'
import { bareJid } from '$lib/utils/jid'

import type { Account } from '../accounts.svelte'
import type { ChatStore } from '../chats.svelte'
import { settings } from '../settings.svelte'

function receiptRequested(message: IncomingMessage): boolean {
  return (
    settings.current.sendReceipts === true &&
    message.receiptRequest === true &&
    Boolean(message.body) &&
    message.type === 'chat' &&
    message.id !== undefined
  )
}

// undecryptable omemo stanzas waiting on a session repair, keyed by
// namespace + sender + sending device. Retried exactly once when a later
// stanza from the same device decrypts, then dropped. Internal
// bookkeeping only - no reactivity needed.
export function messageHandler(
  account: Account,
  store: ChatStore,
  activePeer: () => string | null
): (message: IncomingMessage) => void {
  const undecryptable = new Map<string, IncomingMessage[]>()
  const queueKey = (ns: string, from: string, sid: number) => `${ns}:${bareJid(from)}/${sid}`

  return (message) => {
    // XEP-0434 trust sync arrives as a chat stanza from our own bare
    // jid. Apply it through the omemo service and never ingest it as
    // a conversation row
    if (message.trustMessage && bareJid(message.from) === bareJid(account.jid)) {
      void account.omemo?.applyTrustMessage(message.trustMessage.owners)
      return
    }

    // locally ignored peers never reach the store, even when the
    // server has no XEP-0191 support to filter them for us
    if (account.blocked.has(bareJid(message.from))) return

    // omemo stanzas carry their real body inside the envelope. Decrypt
    // first, then run the normal ingest and receipt path
    if (message.encryptedXml) {
      const omemo = account.omemo
      if (!omemo) {
        message.encrypted = true
        message.undecryptable = true
        message.body = ''
        store.ingest(message, activePeer())
        return
      }
      void omemo.decryptInto(message).then((report) => {
        if (account.blocked.has(bareJid(message.from))) return
        const stored = store.ingest(message, activePeer())
        if (receiptRequested(message)) {
          account.connection.sendReceipt(bareJid(message.from), message.id ?? '')
        }
        if (
          report.status === 'failed' &&
          report.sid !== undefined &&
          report.namespace !== undefined &&
          message.type === 'chat'
        ) {
          const key = queueKey(report.namespace, message.from, report.sid)
          const list = undecryptable.get(key) ?? []
          list.push(message)
          if (list.length > OMEMO_RETRY_QUEUE_MAX) list.shift()
          undecryptable.set(key, list)
          void omemo.sendKeyTransport(message.from, report.sid, report.namespace).then((sent) => {
            if (sent && stored) stored.keyRequested = true
          })
          return
        }
        if (
          (report.status === 'decrypted' || report.status === 'empty') &&
          message.type === 'chat'
        ) {
          // the session with this device now works. Give each queued
          // stanza from it one retry, then drop it for good
          const key = queueKey(report.namespace ?? '', message.from, report.sid ?? 0)
          const queued = undecryptable.get(key)
          if (!queued?.length) return
          undecryptable.delete(key)
          for (const stale of queued) {
            void omemo.decryptInto(stale).then((retry) => {
              // 'decrypted' patches the payload in. 'empty' carried no
              // payload and 'duplicate' means a resend already landed,
              // so the tombstone is stale either way
              if (
                retry.status === 'decrypted' ||
                retry.status === 'empty' ||
                retry.status === 'duplicate'
              ) {
                store.resolveDecrypted(stale)
              }
            })
          }
        }
      })
      return
    }

    store.ingest(message, activePeer())
    // auto-receipt for chat messages that asked for one
    if (receiptRequested(message)) {
      account.connection.sendReceipt(bareJid(message.from), message.id ?? '')
    }
  }
}
