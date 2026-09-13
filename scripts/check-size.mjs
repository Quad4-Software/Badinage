// Enforces the no-god-files rule from AGENTS.md: a source file stays at or
// under 300 lines and a folder at or under 10 direct files. Usage:
// pnpm check:size
// Files and folders already over the limit are grandfathered in the
// allowlists below at their current size. They may shrink but not grow.
// delete an entry when a split brings it under the limit.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const MAX_FILE_LINES = 300
const MAX_DIR_FILES = 10

const SCAN_DIRS = ['src', 'e2e', 'test', 'scripts', 'packages/omemo/src']
const EXTENSIONS = new Set(['.ts', '.svelte', '.mjs'])

// typesafe-i18n output and locale message catalogs are exempt: generated
// files and translation tables grow with the string count, not with
// responsibility. Matches the knip ignore scope.
const EXCLUDE_FILE = /^src\/lib\/i18n\//

// Grandfathered god files: repo-relative path -> line ceiling.
const FILE_ALLOWLIST = new Map([
  ['src/lib/state/accounts.svelte.ts', 728],
  ['src/lib/core/xmpp/demo-data.ts', 714],
  ['src/lib/ui/components/chat/chat-view.svelte', 638],
  ['src/lib/state/chats.svelte.ts', 553],
  ['src/lib/core/omemo/service.ts', 552],
  ['src/lib/core/xmpp/connection.ts', 535],
  ['src/lib/core/xmpp/demo.ts', 525],
  ['src/lib/state/chats.test.ts', 511],
  ['src/lib/ui/components/chat/message-item.svelte', 420],
  ['src/lib/ui/components/chat/composer.svelte', 417],
  ['test/fake-xmpp-server.ts', 369],
  ['src/lib/state/app.svelte.ts', 347],
  ['src/lib/core/xmpp/features/disco.ts', 332],
  ['src/lib/core/xmpp/connection.test.ts', 330],
  ['packages/omemo/src/manager.ts', 327]
])

// Grandfathered folders: repo-relative path -> direct file count ceiling.
const DIR_ALLOWLIST = new Map([
  ['src/lib/utils', 35],
  ['src/lib/core/xmpp/features', 24],
  ['src/lib/state', 19],
  ['src/lib/ui/components/chat', 17],
  ['src/lib/core/xmpp', 16],
  ['src/lib/ui/components/settings', 12]
])

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

function lineCount(file) {
  const text = readFileSync(file, 'utf8')
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
}

const violations = []
const dirs = new Map()
let files = 0

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(path.join(root, scanDir))) {
    const rel = path.relative(root, file)
    if (EXCLUDE_FILE.test(rel)) continue
    const dir = path.dirname(rel)
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
    if (!EXTENSIONS.has(path.extname(file))) continue
    files++
    const lines = lineCount(file)
    const ceiling = FILE_ALLOWLIST.get(rel) ?? MAX_FILE_LINES
    if (lines > ceiling) {
      violations.push(
        FILE_ALLOWLIST.has(rel)
          ? `${rel}: ${lines} lines, grew past grandfathered ceiling of ${ceiling}`
          : `${rel}: ${lines} lines exceeds the ${MAX_FILE_LINES} limit`
      )
    }
  }
}

for (const [dir, count] of dirs) {
  const ceiling = DIR_ALLOWLIST.get(dir) ?? MAX_DIR_FILES
  if (count > ceiling) {
    violations.push(
      DIR_ALLOWLIST.has(dir)
        ? `${dir}/: ${count} files, grew past grandfathered ceiling of ${ceiling}`
        : `${dir}/: ${count} files exceeds the ${MAX_DIR_FILES} limit`
    )
  }
}

for (const rel of [...FILE_ALLOWLIST.keys(), ...DIR_ALLOWLIST.keys()]) {
  try {
    statSync(path.join(root, rel))
  } catch {
    violations.push(`${rel}: allowlisted but no longer exists, remove the entry`)
  }
}

if (violations.length > 0) {
  console.error('size check failed:')
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log(`size check passed: ${files} files, ${dirs.size} folders`)
