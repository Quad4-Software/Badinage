// Attachment upload pipeline for the composer: request a XEP-0363 slot,
// PUT the file, fall back to a data URI for small files when no upload
// service exists (or in demo mode), then send the URL out of band.
// A granted slot shows a pending message row with progress and a cancel
// button; the data-uri path is instant and never needs one.

import { INLINE_ATTACHMENT_LIMIT } from '$lib/constants'
import type { Attachment } from '$lib/core/xmpp/stanzas'
import { blobToDataUri } from '$lib/utils/blob'

import type { Account } from './accounts.svelte'
import { app } from './app.svelte'

// in-flight PUTs keyed by their pending message id so the row's cancel
// button can reach the matching AbortController
const pendingUploads = new Map<string, AbortController>()

// Abort the upload behind a pending message row. The rejection unwinds
// through uploadAndSend which removes the row; a no-op for unknown ids.
export function cancelUpload(messageId: string): void {
  pendingUploads.get(messageId)?.abort()
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function uploadAndSend(
  account: Account,
  peerJid: string,
  type: 'chat' | 'groupchat',
  file: Blob,
  name: string,
  mediaType: string,
  duration: number | undefined,
  onSent: (url: string, attachment: Attachment, id: string) => void,
  onError: () => void
): void {
  const conn = account.connection
  conn.requestUploadSlot(name, file.size, mediaType, async (slot) => {
    let url: string
    if (slot) {
      // pending row: the bubble carries progress and cancel until the
      // PUT resolves, then it is swapped for the real outgoing message
      const store = app.chatsFor(account.jid)
      const pendingId = conn.uniqueId('upload')
      const abort = new AbortController()
      store.push(peerJid, {
        id: pendingId,
        peerJid,
        body: '',
        outgoing: true,
        timestamp: Date.now(),
        encrypted: false,
        delivered: false,
        read: false,
        reactions: {},
        pending: true,
        uploadProgress: 0,
        pendingName: name,
        nick: type === 'groupchat' ? store.open(peerJid).ourNick : undefined
      })
      pendingUploads.set(pendingId, abort)
      try {
        await conn.uploadFile(
          slot.putUrl,
          file,
          undefined,
          (fraction) => {
            const row = store.findMessage(peerJid, pendingId)
            if (row) row.uploadProgress = fraction
          },
          abort.signal
        )
        url = slot.getUrl
      } catch (error) {
        // abort and failure both leave no pending UI; only a real
        // failure reports, a cancel is silent
        store.removeMessage(peerJid, pendingId)
        if (!isAbort(error)) onError()
        return
      } finally {
        pendingUploads.delete(pendingId)
      }
      store.removeMessage(peerJid, pendingId)
    } else {
      if (file.size > INLINE_ATTACHMENT_LIMIT) {
        onError()
        return
      }
      try {
        url = await blobToDataUri(file)
      } catch {
        onError()
        return
      }
    }
    // keep the stanza id so receipts and markers can match this message
    const id = conn.sendAttachment(peerJid, url, type, {
      name,
      mediaType,
      size: file.size,
      duration
    })
    onSent(url, { url, mediaType, name, size: file.size, duration }, id)
  })
}

// Upload a file and push the outgoing message into the chat store so the
// composer can show it optimistically. Shared by the attach button, voice
// messages, paste and drag-and-drop.
export function sendFileMessage(
  account: Account,
  peerJid: string,
  chatType: 'chat' | 'groupchat',
  file: Blob,
  name: string,
  mediaType: string,
  onError: () => void,
  duration?: number
): void {
  uploadAndSend(
    account,
    peerJid,
    chatType,
    file,
    name,
    mediaType,
    duration,
    (url, attachment, id) => {
      const store = app.chatsFor(account.jid)
      const msgId = id ?? account.connection.uniqueId('local')
      store.push(peerJid, {
        id: msgId,
        wireId: id,
        peerJid,
        body: url,
        outgoing: true,
        timestamp: Date.now(),
        encrypted: false,
        delivered: false,
        read: false,
        reactions: {},
        attachments: [attachment],
        nick: chatType === 'groupchat' ? store.open(peerJid).ourNick : undefined
      })
    },
    onError
  )
}
