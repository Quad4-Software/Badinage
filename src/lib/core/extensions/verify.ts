// Signature verification and publisher fingerprints. Packages are
// signed with ed25519 over the canonical manifest plus the code bytes.
// Verification uses WebCrypto, which supports Ed25519 in every engine
// that can run this app.

import { signedPayload } from './manifest'
import type { ExtPackage } from './types'

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function keyFingerprint(keyB64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', b64ToBytes(keyB64) as BufferSource)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0'))
  // eight groups is enough to eyeball, full digest stays derivable
  return hex.slice(0, 16).join(' ')
}

// returns true when the signature over the package validates against
// the publisher key the manifest carries
export async function verifyPackage(pkg: ExtPackage): Promise<boolean> {
  if (!pkg.manifest.publisher || pkg.signature === undefined) return false
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      b64ToBytes(pkg.manifest.publisher.key) as BufferSource,
      'Ed25519',
      false,
      ['verify']
    )
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      b64ToBytes(pkg.signature) as BufferSource,
      signedPayload(pkg) as BufferSource
    )
  } catch {
    return false
  }
}
