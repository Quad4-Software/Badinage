// Attachment upload pipeline for the composer: request a XEP-0363 slot,
// PUT the file, fall back to a data URI for small files when no upload
// service exists (or in demo mode), then send the URL out of band. In an
// encrypted conversation the file is AES-256-GCM encrypted first and the
// aesgcm: url (key in the fragment, never sent to the server) travels
// inside the SCE envelope per XEP-0454. A granted slot shows a pending
// message row with progress and a cancel button. The data-uri path is
// instant and never needs one.

import { INLINE_ATTACHMENT_LIMIT } from '$lib/constants'
import type { Attachment, UploadSlot } from '$lib/core/xmpp/stanzas'
import { aesGcmSize, buildAesGcmUrl, encryptAesGcm, primeAesGcm } from '$lib/utils/aesgcm'
import { blobToDataUri } from '$lib/utils/blob'

import type { Account } from './accounts.svelte'
import { app } from './app.svelte'

// in-flight PUTs keyed by their pending message id so the row's cancel
// button can reach the matching AbortController
const pendingUploads = new Map<string, AbortController>()

// Abort the upload behind a pending message row. The rejection unwinds
// through uploadAndSend which removes the row. A no-op for unknown ids.
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
        // abort and failure both leave no pending UI. Only a real
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

// XEP-0454: encrypt the file, upload the ciphertext, and send the aesgcm
// url inside an encrypted envelope. When no upload service exists a data
// uri still works - it rides inside the envelope so it stays encrypted.
// Returns false only when the peer publishes no usable omemo devices, in
// which case the caller falls back to the plaintext path.
async function uploadEncrypted(
  account: Account,
  omemo: NonNullable<Account['omemo']>,
  peerJid: string,
  file: Blob,
  name: string,
  mediaType: string,
  duration: number | undefined,
  onSent: (url: string, attachment: Attachment, id: string) => void,
  onError: () => void
): Promise<boolean> {
  try {
    let url: string
    const plaintext = new Uint8Array(await file.arrayBuffer())
    const slot = await new Promise<UploadSlot | null>((resolve) => {
      account.connection.requestUploadSlot(name, aesGcmSize(file.size), mediaType, resolve)
    })
    if (slot) {
      const { ciphertext, key, iv } = await encryptAesGcm(plaintext)
      const blob = new Blob([ciphertext as BlobPart], { type: 'application/octet-stream' })
      await account.connection.uploadFile(slot.putUrl, blob)
      const shareUrl = buildAesGcmUrl(slot.getUrl, key, iv)
      if (shareUrl === null) {
        onError()
        return true
      }
      url = shareUrl
      primeAesGcm(url, new Blob([plaintext as BlobPart], { type: mediaType }))
    } else {
      if (file.size > INLINE_ATTACHMENT_LIMIT) {
        onError()
        return true
      }
      url = await blobToDataUri(file)
    }
    const meta = { name, mediaType, size: file.size, duration }
    const xml = await omemo.encryptAttachment(peerJid, url, meta)
    if (xml === null) return false
    const id = account.connection.sendEncryptedMessage(peerJid, xml)
    onSent(url, { url, mediaType, name, size: file.size, duration }, id)
    return true
  } catch {
    onError()
    return true
  }
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
  // encryption=true means the send was refused by the conversation's
  // required-encryption override, not an upload failure
  onError: (encryption?: boolean) => void,
  duration?: number
): void {
  const store = app.chatsFor(account.jid)
  const conversation = store.open(peerJid)
  const onSent = (url: string, attachment: Attachment, id: string) => {
    const msgId = id ?? account.connection.uniqueId('local')
    store.push(peerJid, {
      id: msgId,
      wireId: id,
      peerJid,
      body: url,
      outgoing: true,
      timestamp: Date.now(),
      encrypted: conversation.encrypted === true,
      delivered: false,
      read: false,
      reactions: {},
      attachments: [attachment],
      nick: chatType === 'groupchat' ? conversation.ourNick : undefined
    })
  }

  // in a dm, try the encrypted path whenever the service resolves - the
  // first thing ever sent may be a file. A false result means the peer
  // publishes no usable devices: fall back to plaintext and keep the
  // encrypted flag honest. The conversation override can force either
  // side: 'none' skips omemo, 'omemo' refuses the plaintext fallback.
  // Groupchat has no encrypted attachment path at all.
  const preference = conversation.encryption ?? 'auto'
  if (chatType === 'chat' && preference !== 'none') {
    void Promise.resolve(account.omemo ?? account.omemoService()).then((omemo) => {
      if (!omemo) {
        if (preference === 'omemo') onError(true)
        else
          uploadAndSend(
            account,
            peerJid,
            chatType,
            file,
            name,
            mediaType,
            duration,
            onSent,
            onError
          )
        return
      }
      void uploadEncrypted(
        account,
        omemo,
        peerJid,
        file,
        name,
        mediaType,
        duration,
        (url, attachment, id) => {
          conversation.encrypted = true
          onSent(url, attachment, id)
        },
        onError
      ).then((sent) => {
        if (sent) return
        if (preference === 'omemo') {
          onError(true)
          return
        }
        conversation.encrypted = false
        uploadAndSend(account, peerJid, chatType, file, name, mediaType, duration, onSent, onError)
      })
    })
    return
  }
  if (preference === 'omemo') {
    onError(true)
    return
  }
  uploadAndSend(account, peerJid, chatType, file, name, mediaType, duration, onSent, onError)
}
