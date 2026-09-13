// Element traversal helpers shared by stanza and payload parsing. These
// take and return DOM types only. The test suite runs under
// @xmldom/xmldom which has no selector engine, so only
// getElementsByTagName(NS) is used here - never querySelector.

// first descendant matching a local name in any namespace
export function firstTag(el: Element, local: string): Element | null {
  const found = el.getElementsByTagName(local)
  return found.length > 0 ? (found.item(0) as Element) : null
}

// first descendant matching a namespace and local name
export function firstNsTag(el: Element, ns: string, local: string): Element | null {
  const found = el.getElementsByTagNameNS(ns, local)
  return found.length > 0 ? (found.item(0) as Element) : null
}

// all descendants matching a namespace and local name
export function allNsTags(el: Element, ns: string, local: string): Element[] {
  const found = el.getElementsByTagNameNS(ns, local)
  const out: Element[] = []
  for (let i = 0; i < found.length; i++) out.push(found.item(i) as Element)
  return out
}

// all descendants matching a local name in any namespace
export function allTags(el: Element, local: string): Element[] {
  const found = el.getElementsByTagName(local)
  const out: Element[] = []
  for (let i = 0; i < found.length; i++) out.push(found.item(i) as Element)
  return out
}

// text content of the first descendant matching a local name
export function firstTagText(el: Element, local: string): string | null {
  return firstTag(el, local)?.textContent ?? null
}

// direct children that are elements, skipping text and comment nodes.
// needed where descendant search would overmatch, e.g. the condition
// child of a stanza error or value children vs option children of a
// data form field
export function childElements(el: Element): Element[] {
  const out: Element[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i)
    if (node.nodeType === 1) out.push(node as Element)
  }
  return out
}

// escape a string for use as xml text content or a double-quoted
// attribute value. Used when serializing payloads to raw xml strings
export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// DOM Elements serialize via outerHTML. Under xmldom toString does the
// same job. The OMEMO parser consumes the serialized form.
export function serializeElement(el: Element): string {
  const outer = (el as { outerHTML?: string }).outerHTML
  return outer ?? (el as unknown as { toString(): string }).toString()
}
