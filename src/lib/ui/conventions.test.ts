import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

// The UI convention audit: rules that review can miss get a repeatable
// scan instead, in the same style as the storage namespace audit.
// Every rule below encodes a convention from AGENTS.md / the frontend
// skill so a violation fails the suite, not just a comment thread.
//
// - runes only: no legacy export let in components
// - no user-facing literals: aria-label, placeholder and title must go
//   through $LL, never a quoted string
// - theme tokens only: no raw hex colors in component markup
// - no html injection sinks: {@html, innerHTML, eval and document.cookie
//   stay out of app code entirely

const SRC_ROOT = join(import.meta.dirname, '..', '..')
const UI_ROOT = join(import.meta.dirname)

const RULES: { name: string; pattern: RegExp; glob: RegExp; roots: string[] }[] = [
  {
    name: 'no legacy export let (runes only)',
    pattern: /\bexport\s+let\s/,
    glob: /\.svelte$/,
    roots: [UI_ROOT]
  },
  {
    name: 'no literal aria-label, placeholder or title (use $LL)',
    pattern: /\b(?:aria-label|placeholder|title)="[^"{]*[a-zA-Z][^"{]*"/,
    glob: /\.svelte$/,
    roots: [UI_ROOT]
  },
  {
    name: 'no raw hex colors (theme tokens only)',
    pattern: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/,
    glob: /\.svelte$/,
    roots: [UI_ROOT]
  },
  {
    name: 'no html injection sinks ({@html, innerHTML, eval, document.cookie)',
    pattern: /\{@html\b|\binnerHTML\s*=|\beval\s*\(|\bdocument\s*\.\s*cookie\b/,
    glob: /\.(?:ts|svelte)$/,
    roots: [SRC_ROOT]
  }
]

function* sources(dir: string, glob: RegExp): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* sources(path, glob)
    } else if (glob.test(entry.name)) {
      yield path
    }
  }
}

describe('ui conventions audit', () => {
  for (const rule of RULES) {
    it(rule.name, () => {
      const violations: string[] = []
      for (const root of rule.roots) {
        for (const path of sources(root, rule.glob)) {
          const rel = relative(join(SRC_ROOT, '..'), path)
          if (rel.endsWith('conventions.test.ts')) continue
          const text = readFileSync(path, 'utf8')
          if (rule.pattern.test(text)) violations.push(rel)
        }
      }
      expect(violations).toEqual([])
    })
  }
})
