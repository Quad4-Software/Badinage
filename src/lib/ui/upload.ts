// Attachment upload pipeline for the composer: request a XEP-0363 slot,
// PUT the file, fall back to a data URI for small files when no upload
// service exists (or in demo mode), then send the URL out of band.

import type { ChatConnection } from '$lib/core/xmpp/connection'
import type { Attachment } from '$lib/state/chats.svelte'

import { blobToDataUri } from './voice.svelte'

const INLINE_LIMIT = 512 * 1024

export function uploadAndSend(
  conn: ChatConnection,
  peerJid: string,
  type: 'chat' | 'groupchat',
  file: Blob,
  name: string,
  mediaType: string,
  duration: number | undefined,
  onSent: (url: string, attachment: Attachment) => void,
  onError: () => void
): void {
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
      if (file.size > INLINE_LIMIT) {
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
    conn.sendAttachment(peerJid, url, type, { name, mediaType, size: file.size, duration })
    onSent(url, { url, mediaType, name, size: file.size, duration })
  })
}
