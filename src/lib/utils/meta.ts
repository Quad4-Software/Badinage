// Live <head> updates for the SPA. index.html carries the static
// defaults that crawlers and link unfurls read at fetch time. These
// helpers keep the same tags in sync while the app runs - the unread
// count in the tab title today, per-view titles if routing ever lands.

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.append(el)
  }
  el.content = content
}

export interface PageMeta {
  title?: string | undefined
  description?: string | undefined
  image?: string | undefined
}

// Update the document title plus the matching description/og/twitter
// tags. Fields left undefined keep their current values.
export function updatePageMeta(meta: PageMeta): void {
  if (meta.title !== undefined) {
    document.title = meta.title
    setMeta('property', 'og:title', meta.title)
    setMeta('name', 'twitter:title', meta.title)
  }
  if (meta.description !== undefined) {
    setMeta('name', 'description', meta.description)
    setMeta('property', 'og:description', meta.description)
    setMeta('name', 'twitter:description', meta.description)
  }
  if (meta.image !== undefined) {
    setMeta('property', 'og:image', meta.image)
    setMeta('name', 'twitter:image', meta.image)
  }
}
