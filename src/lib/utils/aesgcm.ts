// XEP-0454 OMEMO media sharing. A file is encrypted client side with
// AES-256-GCM, the ciphertext (with appended tag, which is what WebCrypto
// produces) is uploaded via XEP-0363, and the shared url is the https
// download url with the scheme swapped to aesgcm: and a fragment of
// hex(iv) followed by hex(key). The fragment never reaches the server.
// aesgcm: urls must never be linkified or opened directly: the anchor
// carries the decryption key.

import { AESGCM_IV_BYTES, AESGCM_KEY_BYTES, AESGCM_TAG_BYTES } from '$lib/constants'

const SCHEME = 'aesgcm:'
const FRAGMENT_HEX = (AESGCM_IV_BYTES + AESGCM_KEY_BYTES) * 2

const HEX_CHARS = '0123456789abcdef'

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0x0f)
  return out
}

function fromHex(text: string): Uint8Array | null {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(text)) return null
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function isAesGcmUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(SCHEME)
}

export interface AesGcmLink {
  // https url the ciphertext is fetched from
  downloadUrl: string
  key: Uint8Array
  iv: Uint8Array
}

// Strict parse of an aesgcm: url. Null for anything malformed.
export function parseAesGcmUrl(url: string): AesGcmLink | null {
  const trimmed = url.trim()
  if (!isAesGcmUrl(trimmed)) return null
  const hash = trimmed.indexOf('#')
  if (hash < 0) return null
  const fragment = trimmed.slice(hash + 1)
  if (fragment.length !== FRAGMENT_HEX) return null
  const bytes = fromHex(fragment)
  if (bytes === null) return null
  const downloadUrl = `https:${trimmed.slice(SCHEME.length, hash)}`
  try {
    const parsed = new URL(downloadUrl)
    if (parsed.protocol !== 'https:' || !parsed.host) return null
  } catch {
    return null
  }
  return {
    downloadUrl,
    iv: bytes.slice(0, AESGCM_IV_BYTES),
    key: bytes.slice(AESGCM_IV_BYTES)
  }
}

// Build the share url for an uploaded ciphertext. Returns null when the
// upload service handed back a non-https url, which must never be
// converted to aesgcm per the XEP.
export function buildAesGcmUrl(getUrl: string, key: Uint8Array, iv: Uint8Array): string | null {
  if (key.length !== AESGCM_KEY_BYTES || iv.length !== AESGCM_IV_BYTES) return null
  let parsed: URL
  try {
    parsed = new URL(getUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  return `aesgcm:${parsed.href.slice('https:'.length)}#${toHex(iv)}${toHex(key)}`
}

export interface AesGcmEncryption {
  // ciphertext with the GCM tag appended, ready for upload
  ciphertext: Uint8Array
  key: Uint8Array
  iv: Uint8Array
}

export async function encryptAesGcm(plaintext: Uint8Array): Promise<AesGcmEncryption> {
  const key = crypto.getRandomValues(new Uint8Array(AESGCM_KEY_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(AESGCM_IV_BYTES))
  const subtleKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [
    'encrypt'
  ])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      subtleKey,
      plaintext as BufferSource
    )
  )
  return { ciphertext, key, iv }
}

export async function decryptAesGcm(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const subtleKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [
    'decrypt'
  ])
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        subtleKey,
        ciphertext as BufferSource
      )
    )
  } catch {
    throw new Error('aesgcm: decryption failed')
  }
}

// Upload size accounting: the GCM tag is appended to the file.
export function aesGcmSize(plainSize: number): number {
  return plainSize + AESGCM_TAG_BYTES
}

// Resolved plaintext blobs for urls we produced ourselves, so our own
// outgoing attachments render without a download round trip.
const resolved = new Map<string, Blob>()

export function primeAesGcm(url: string, blob: Blob): void {
  resolved.set(url, blob)
  if (resolved.size > 64) {
    const oldest = resolved.keys().next().value
    if (oldest !== undefined) resolved.delete(oldest)
  }
}

// Download and decrypt an aesgcm: url into a plaintext Blob. Throws on
// malformed urls, http failures and decryption failures.
export async function fetchAesGcm(url: string): Promise<Blob> {
  const own = resolved.get(url)
  if (own) return own
  const link = parseAesGcmUrl(url)
  if (!link) throw new Error('aesgcm: malformed url')
  const response = await fetch(link.downloadUrl)
  if (!response.ok) throw new Error(`aesgcm: download failed with ${response.status}`)
  const ciphertext = new Uint8Array(await response.arrayBuffer())
  const plaintext = await decryptAesGcm(link.key, link.iv, ciphertext)
  return new Blob([plaintext as BlobPart])
}
