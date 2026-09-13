// XEP-0363 http upload: service discovery, slot requests, and the PUT
// of the blob to the granted slot url.

import { $iq } from 'strophe.js'

import { jidDomain } from '$lib/utils/jid'

import { NS } from '../ns'
import { hasDiscoFeature, parseDiscoItemJids, parseUploadSlot, type UploadSlot } from '../stanzas'
import type { XmppTransport } from './transport'

// Finds the upload service: items disco on our server domain, then info
// disco on each item until one advertises the http upload feature.
export function discoverUploadService(
  conn: XmppTransport,
  onDone: (serviceJid: string | null) => void
): void {
  const domain = jidDomain(conn.jid)
  if (!domain) {
    onDone(null)
    return
  }
  conn.sendIq(
    $iq({ type: 'get', to: domain, id: conn.uniqueId('disco-items') }).c('query', {
      xmlns: NS.DISCO_ITEMS
    }),
    (stanza) => probeUploadServices(conn, parseDiscoItemJids(stanza), onDone),
    () => onDone(null)
  )
}

function probeUploadServices(
  conn: XmppTransport,
  jids: string[],
  onDone: (serviceJid: string | null) => void
): void {
  const [next, ...rest] = jids
  if (!next) {
    onDone(null)
    return
  }
  conn.sendIq(
    $iq({ type: 'get', to: next, id: conn.uniqueId('disco-info') }).c('query', {
      xmlns: NS.DISCO_INFO
    }),
    (stanza) => {
      if (hasDiscoFeature(stanza, NS.HTTP_UPLOAD)) {
        onDone(next)
        return
      }
      probeUploadServices(conn, rest, onDone)
    },
    () => probeUploadServices(conn, rest, onDone)
  )
}

export function requestUploadSlot(
  conn: XmppTransport,
  name: string,
  size: number,
  mediaType: string,
  onDone: (slot: UploadSlot | null) => void
): void {
  discoverUploadService(conn, (serviceJid) => {
    if (!serviceJid) {
      onDone(null)
      return
    }
    conn.sendIq(
      $iq({ type: 'get', to: serviceJid, id: conn.uniqueId('upload') })
        .c('request', { xmlns: NS.HTTP_UPLOAD })
        .c('filename')
        .t(name)
        .up()
        .c('size')
        .t(String(size))
        .up()
        .c('content-type')
        .t(mediaType),
      (stanza) => onDone(parseUploadSlot(stanza)),
      () => onDone(null)
    )
  })
}

// Plain PUT of the blob to the slot url. fetch cannot report upload
// progress, so a progress callback switches to XMLHttpRequest.
export function uploadFile(
  putUrl: string,
  file: Blob,
  headers: Record<string, string> = {},
  onProgress?: (fraction: number) => void
): Promise<void> {
  if (!onProgress) {
    return fetch(putUrl, { method: 'PUT', headers, body: file }).then((res) => {
      if (!res.ok) throw new Error(`upload failed: ${res.status}`)
    })
  }
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`upload failed: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('upload failed'))
    xhr.open('PUT', putUrl)
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
    xhr.send(file)
  })
}
