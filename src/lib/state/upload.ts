// Attachment upload pipeline for the composer: request a XEP-0363 slot,
// PUT the file, fall back to a data URI for small files when no upload
// service exists (or in demo mode), then send the URL out of band. In an
// encrypted conversation the file is AES-256-GCM encrypted first and the
// aesgcm: url (key in the fragment, never sent to the server) travels
// inside the SCE envelope per XEP-0454.

import { INLINE_ATTACHMENT_LIMIT } from '$lib/constants'
import type { Attachment, UploadSlot } from '$lib/core/xmpp/stanzas'
import { aesGcmSize, buildAesGcmUrl, encryptAesGcm, primeAesGcm } from '$lib/utils/aesgcm'
import { blobToDataUri } from '$lib/utils/blob'

import type { Account } from './accounts.svelte'
import { app } from './app.svelte'

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
      try {
        await conn.uploadFile(slot.putUrl, file)
        url = slot.getUrl
      } catch {
        onError()
        return
      }
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
  onError: () => void,
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
  // encrypted flag honest.
  if (chatType === 'chat') {
    void Promise.resolve(account.omemo ?? account.omemoService()).then((omemo) => {
      if (!omemo) {
        uploadAndSend(account, peerJid, chatType, file, name, mediaType, duration, onSent, onError)
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
        conversation.encrypted = false
        uploadAndSend(account, peerJid, chatType, file, name, mediaType, duration, onSent, onError)
      })
    })
    return
  }
  uploadAndSend(account, peerJid, chatType, file, name, mediaType, duration, onSent, onError)
}
