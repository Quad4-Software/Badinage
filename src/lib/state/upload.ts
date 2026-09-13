// Attachment upload pipeline for the composer: request a XEP-0363 slot,
// PUT the file, fall back to a data URI for small files when no upload
// service exists (or in demo mode), then send the URL out of band.

import { INLINE_ATTACHMENT_LIMIT } from '$lib/constants'
import type { Attachment } from '$lib/core/xmpp/stanzas'
import { blobToDataUri } from '$lib/utils/blob'

import type { Account } from './accounts.svelte'

export function uploadAndSend(
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
