// RFC 7636 PKCE helpers plus the random values the OAuth flow needs.
// WebCrypto only: no Math.random for anything that crosses the wire.

import { OAUTH_PKCE_BYTES, OAUTH_STATE_BYTES } from '$lib/constants'

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function randomUrlSafe(byteCount: number): string {
  const buf = new Uint8Array(byteCount)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

export interface PkcePair {
  verifier: string
  challenge: string
}

export async function pkcePair(): Promise<PkcePair> {
  const verifier = randomUrlSafe(OAUTH_PKCE_BYTES)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function oauthState(): string {
  return randomUrlSafe(OAUTH_STATE_BYTES)
}
