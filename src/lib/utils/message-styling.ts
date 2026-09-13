// XEP-0393 message styling: a pure tokenizer turning a message body into
// a typed block/span tree. Rendering lives in message-body.svelte which
// maps these tokens to real elements; nothing here ever produces HTML.
//
// Rules implemented from XEP-0393 section 6:
// - blocks are parsed before spans: a line starting with ``` opens a
//   preformatted block that runs to a line containing only ``` or the end
//   of the input; consecutive lines starting with > form a quotation
//   whose stripped contents are parsed recursively as child blocks
// - a plain block is a single line; spans never escape their line
// - span directives are * (strong), _ (emphasis), ~ (strike) and `
//   (preformatted span). The opener must sit at the start of its parent
//   block, after whitespace, or after a different directive char, and
//   must not be followed by whitespace. The closer must not be preceded
//   by whitespace and there must be text between the directives.
// - matching is lazy: the first same-char candidate closes the span; if
//   that pair is invalid neither char is a directive and scanning moves
//   on, so "* plain *strong*" styles only the second pair
// - a preformatted span contains plain text only; other styled spans
//   recursively contain child spans
// - characters that fail these rules stay literal text

export type SpanToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: SpanToken[] }
  | { type: 'emphasis'; children: SpanToken[] }
  | { type: 'strike'; children: SpanToken[] }
  | { type: 'code'; text: string }

export type BlockToken =
  | { type: 'line'; spans: SpanToken[] }
  | { type: 'pre'; text: string }
  | { type: 'quote'; children: BlockToken[] }

const SPAN_DIRECTIVES = new Map<string, 'strong' | 'emphasis' | 'strike' | 'code'>([
  ['*', 'strong'],
  ['_', 'emphasis'],
  ['~', 'strike'],
  ['`', 'code']
])

const PRE_FENCE = '```'

// White_Space property or general category Z, per the XEP glossary. The
// JS \s class covers White_Space plus U+FEFF; \p{Z} adds the separators.
function isSpace(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false
  return /[\s\p{Z}]/u.test(String.fromCodePoint(codePoint))
}

function isDirective(char: string | undefined): boolean {
  return char !== undefined && SPAN_DIRECTIVES.has(char)
}

// An opener must be at the start of the text, after whitespace, or after
// a different directive character, and must be followed by a
// non-whitespace character.
function isOpener(text: string, at: number): boolean {
  const char = text[at]
  if (!isDirective(char)) return false
  const next = text.codePointAt(at + 1)
  if (next === undefined || isSpace(next)) return false
  if (at === 0) return true
  const prevCode = text.codePointAt(at - 1)
  if (isSpace(prevCode)) return true
  const prev = prevCode === undefined ? undefined : String.fromCodePoint(prevCode)
  return isDirective(prev) && prev !== char
}

// The closer is the first same-char occurrence after the opener. The pair
// is valid only when there is text between the directives and the closer
// is not preceded by whitespace; otherwise the opener is not a directive
// at all (lazy matching, neither char counts).
function findClose(text: string, openAt: number): number {
  const char = text[openAt] as string
  const at = text.indexOf(char, openAt + 1)
  if (at === -1) return -1
  if (at === openAt + 1) return -1
  if (isSpace(text.codePointAt(at - 1))) return -1
  return at
}

function parseSpans(text: string): SpanToken[] {
  const tokens: SpanToken[] = []
  let plain = ''
  const flush = () => {
    if (plain) {
      tokens.push({ type: 'text', text: plain })
      plain = ''
    }
  }
  let i = 0
  while (i < text.length) {
    const char = text[i] as string
    const style = SPAN_DIRECTIVES.get(char)
    if (style === undefined || !isOpener(text, i)) {
      plain += char
      i++
      continue
    }
    const close = findClose(text, i)
    if (close === -1) {
      plain += char
      i++
      continue
    }
    flush()
    const content = text.slice(i + 1, close)
    if (style === 'code') {
      tokens.push({ type: 'code', text: content })
    } else {
      tokens.push({ type: style, children: parseSpans(content) })
    }
    i = close + 1
  }
  flush()
  return tokens
}

// A quotation line loses its leading > plus exactly one whitespace
// character before the child block parses it.
function stripQuoteMarker(line: string): string {
  const inner = line.slice(1)
  const first = inner.codePointAt(0)
  if (first !== undefined && isSpace(first)) {
    return inner.slice(String.fromCodePoint(first).length)
  }
  return inner
}

function parseBlocks(lines: string[]): BlockToken[] {
  const blocks: BlockToken[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.startsWith(PRE_FENCE)) {
      i++
      const content: string[] = []
      while (i < lines.length && lines[i] !== PRE_FENCE) {
        content.push(lines[i] ?? '')
        i++
      }
      // consume the closing fence when the block was terminated
      if (i < lines.length) i++
      blocks.push({ type: 'pre', text: content.join('\n') })
      continue
    }
    if (line.startsWith('>')) {
      const quoted: string[] = []
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        quoted.push(stripQuoteMarker(lines[i] ?? ''))
        i++
      }
      blocks.push({ type: 'quote', children: parseBlocks(quoted) })
      continue
    }
    blocks.push({ type: 'line', spans: parseSpans(line) })
    i++
  }
  return blocks
}

// Tokenize a message body into its styling tree. An empty body yields a
// single empty line block.
export function tokenizeStyling(body: string): BlockToken[] {
  return parseBlocks(body.split('\n'))
}
