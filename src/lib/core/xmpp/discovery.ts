export interface ConnectionEndpoints {
  websocket?: string
  bosh?: string
}

import { HOST_META_REL } from './ns'

export async function discoverEndpoints(domain: string): Promise<ConnectionEndpoints> {
  const fromJson = await fetchHostMetaJson(domain)
  if (fromJson.websocket || fromJson.bosh) return fromJson
  return fetchHostMetaXml(domain)
}

async function fetchHostMetaJson(domain: string): Promise<ConnectionEndpoints> {
  try {
    const res = await fetch(`https://${domain}/.well-known/host-meta.json`)
    if (!res.ok) return {}
    const data = (await res.json()) as { links?: { rel?: string; href?: string }[] }
    return linksToEndpoints(data.links ?? [])
  } catch {
    return {}
  }
}

async function fetchHostMetaXml(domain: string): Promise<ConnectionEndpoints> {
  try {
    const res = await fetch(`https://${domain}/.well-known/host-meta`)
    if (!res.ok) return {}
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')
    const links = [...doc.querySelectorAll('Link')].map((el) => ({
      rel: el.getAttribute('rel') ?? undefined,
      href: el.getAttribute('href') ?? undefined
    }))
    return linksToEndpoints(links)
  } catch {
    return {}
  }
}

function linksToEndpoints(
  links: { rel?: string | undefined; href?: string | undefined }[]
): ConnectionEndpoints {
  const endpoints: ConnectionEndpoints = {}
  for (const link of links) {
    if (!link.href) continue
    if (link.rel === HOST_META_REL.WEBSOCKET) endpoints.websocket = link.href
    if (link.rel === HOST_META_REL.BOSH) endpoints.bosh = link.href
  }
  return endpoints
}
