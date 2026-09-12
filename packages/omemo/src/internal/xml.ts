// Minimal XML element model, serializer and parser. This deliberately supports
// only the subset of XML that OMEMO stanza fragments and SCE envelopes need:
// elements, attributes, text and CDATA. Simplification: element children keep
// their order while all text inside an element is concatenated into `text`.
// That is fine for the wire formats handled here since text is always leaf
// content.

import { ParseError } from '../errors'

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  text: string
}

export function el(
  name: string,
  attrs: Record<string, string> = {},
  children: XmlElement[] = [],
  text = ''
): XmlElement {
  return { name, attrs, children, text }
}

export function findChild(node: XmlElement, name: string): XmlElement | undefined {
  return node.children.find((child) => child.name === name)
}

export function childrenNamed(node: XmlElement, name: string): XmlElement[] {
  return node.children.filter((child) => child.name === name)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, (_, ent: string) => {
    if (ent.startsWith('#x')) return String.fromCodePoint(parseInt(ent.slice(2), 16))
    if (ent.startsWith('#')) return String.fromCodePoint(parseInt(ent.slice(1), 10))
    const mapped = ENTITIES[ent]
    if (mapped === undefined) throw new ParseError(`unknown XML entity &${ent};`)
    return mapped
  })
}

export function serializeXml(node: XmlElement): string {
  let out = `<${node.name}`
  for (const [key, value] of Object.entries(node.attrs)) out += ` ${key}='${escapeXml(value)}'`
  if (node.children.length === 0 && node.text === '') return `${out}/>`
  out += '>'
  out += escapeXml(node.text)
  for (const child of node.children) out += serializeXml(child)
  return `${out}</${node.name}>`
}

const NAME_CHAR = /[A-Za-z0-9_.:\-]/

export function parseXml(input: string): XmlElement {
  let pos = 0

  function error(message: string): never {
    throw new ParseError(`XML parse error at offset ${pos}: ${message}`)
  }

  function skipMisc(): void {
    for (;;) {
      if (input.startsWith('<!--', pos)) {
        const end = input.indexOf('-->', pos + 4)
        if (end < 0) error('unterminated comment')
        pos = end + 3
      } else if (input.startsWith('<?', pos)) {
        const end = input.indexOf('?>', pos + 2)
        if (end < 0) error('unterminated processing instruction')
        pos = end + 2
      } else if (input.startsWith('<!', pos)) {
        const end = input.indexOf('>', pos + 2)
        if (end < 0) error('unterminated doctype')
        pos = end + 1
      } else if (/\s/.test(input[pos] ?? '')) {
        pos++
      } else {
        return
      }
    }
  }

  function readName(): string {
    const start = pos
    while (pos < input.length && NAME_CHAR.test(input[pos] ?? '')) pos++
    if (pos === start) error('expected name')
    return input.slice(start, pos)
  }

  function parseElement(): XmlElement {
    if (input[pos] !== '<') error('expected <')
    pos++
    const name = readName()
    const node: XmlElement = { name, attrs: {}, children: [], text: '' }
    for (;;) {
      skipMisc()
      if (input[pos] === '/' && input[pos + 1] === '>') {
        pos += 2
        return node
      }
      if (input[pos] === '>') {
        pos++
        break
      }
      const attrName = readName()
      skipMisc()
      if (input[pos] !== '=') error(`expected = after attribute ${attrName}`)
      pos++
      skipMisc()
      const quote = input[pos]
      if (quote !== "'" && quote !== '"') error('expected quoted attribute value')
      pos++
      const end = input.indexOf(quote, pos)
      if (end < 0) error('unterminated attribute value')
      node.attrs[attrName] = unescapeXml(input.slice(pos, end))
      pos = end + 1
    }
    for (;;) {
      if (input.startsWith('</', pos)) {
        pos += 2
        const closeName = readName()
        skipMisc()
        if (input[pos] !== '>') error('expected > in closing tag')
        pos++
        if (closeName !== name) error(`mismatched closing tag </${closeName}> for <${name}>`)
        return node
      }
      if (input.startsWith('<![CDATA[', pos)) {
        const end = input.indexOf(']]>', pos + 9)
        if (end < 0) error('unterminated CDATA')
        node.text += input.slice(pos + 9, end)
        pos = end + 3
        continue
      }
      if (input.startsWith('<!--', pos)) {
        const end = input.indexOf('-->', pos + 4)
        if (end < 0) error('unterminated comment')
        pos = end + 3
        continue
      }
      if (input.startsWith('<?', pos)) {
        const end = input.indexOf('?>', pos + 2)
        if (end < 0) error('unterminated PI')
        pos = end + 2
        continue
      }
      if (input[pos] === '<') {
        node.children.push(parseElement())
        continue
      }
      const start = pos
      while (pos < input.length && input[pos] !== '<') pos++
      if (pos >= input.length) error(`unterminated element <${name}>`)
      node.text += unescapeXml(input.slice(start, pos))
    }
  }

  skipMisc()
  const root = parseElement()
  skipMisc()
  if (pos < input.length) error('trailing content after root element')
  return root
}
