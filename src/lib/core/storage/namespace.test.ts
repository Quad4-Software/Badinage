import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

// The per-account namespace rule: every storage key must be built by
// scopedKey/globalKey and every storage touch must happen inside
// core/storage. This scan makes the audit repeatable: raw web storage
// or IndexedDB calls outside core/storage fail the suite.
//
// The pattern matches call shapes (setItem, open, bracket access) rather
// than the bare identifiers so prose and test scaffolding stay clean.

const SRC_ROOT = join(import.meta.dirname, '..', '..', '..')

// directories allowed to touch storage primitives directly
const ALLOWED = ['src/lib/core/storage/']

// files allowed even though they sit outside the allowed directories
const ALLOWED_FILES = new Set<string>([
  // asserts the ScopedSmStorage adapter writes the real sessionStorage
  // key layout, which requires reading the store it wraps
  'src/lib/core/xmpp/features/sm.test.ts',
  // injects malformed json into the pending-flow slot to prove the
  // reader drops it; the public api cannot write malformed data
  'src/lib/core/oauth/session.test.ts'
])

const RAW_USE =
  /\b(?:localStorage|sessionStorage)\s*(?:\.\s*(?:getItem|setItem|removeItem|clear|key|length)\b|\[)|\bindexedDB\s*\.\s*open\b/

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* sources(path)
    } else if (/\.(ts|svelte)$/.test(entry.name)) {
      yield path
    }
  }
}

describe('storage namespace audit', () => {
  it('finds no raw storage API use outside core/storage', () => {
    const violations: string[] = []
    for (const path of sources(SRC_ROOT)) {
      const rel = relative(join(SRC_ROOT, '..'), path)
      if (rel === 'src/lib/core/storage/namespace.test.ts') continue
      if (ALLOWED_FILES.has(rel)) continue
      if (ALLOWED.some((dir) => rel.startsWith(dir))) continue
      const text = readFileSync(path, 'utf8')
      if (RAW_USE.test(text)) violations.push(rel)
    }
    expect(violations).toEqual([])
  })
})
