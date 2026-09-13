import { DOMParser as XmlDOMParser } from '@xmldom/xmldom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { discoverEndpoints } from './discovery'

// discovery.ts runs against the browser DOMParser, which the node test
// environment lacks. xmldom has no selector engine, so the stub wraps an
// xmldom document and answers querySelectorAll through
// getElementsByTagNameNS, which is enough for the flat Link elements of
// XEP-0156 host-meta.
class StubDOMParser {
  parseFromString(markup: string): { querySelectorAll(local: string): Element[] } {
    const doc = new XmlDOMParser().parseFromString(markup, 'application/xml')
    return {
      querySelectorAll(local: string): Element[] {
        const found = doc.getElementsByTagNameNS('*', local)
        const out: Element[] = []
        for (let i = 0; i < found.length; i++) {
          out.push(found.item(i) as unknown as Element)
        }
        return out
      }
    }
  }
}

function jsonResponse(data: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(data) } as unknown as Response
}

function textResponse(text: string, ok = true): Response {
  return { ok, text: () => Promise.resolve(text) } as unknown as Response
}

const XRD = `
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="urn:xmpp:alt-connections:websocket" href="wss://example.net/xmpp-websocket"/>
  <Link rel="urn:xmpp:alt-connections:xbosh" href="https://example.net:5280/bosh"/>
</XRD>`

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('DOMParser', StubDOMParser)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('discoverEndpoints', () => {
  it('returns endpoints from host-meta.json without touching xml', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        links: [
          { rel: 'urn:xmpp:alt-connections:websocket', href: 'wss://example.net/ws' },
          { rel: 'urn:xmpp:alt-connections:xbosh', href: 'https://example.net/bosh' }
        ]
      })
    )

    const endpoints = await discoverEndpoints('example.net')

    expect(endpoints).toEqual({
      websocket: 'wss://example.net/ws',
      bosh: 'https://example.net/bosh'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://example.net/.well-known/host-meta.json')
  })

  it('falls back to host-meta xml when json has no endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ links: [] }))
      .mockResolvedValueOnce(textResponse(XRD))

    const endpoints = await discoverEndpoints('example.net')

    expect(endpoints).toEqual({
      websocket: 'wss://example.net/xmpp-websocket',
      bosh: 'https://example.net:5280/bosh'
    })
    expect(fetchMock).toHaveBeenLastCalledWith('https://example.net/.well-known/host-meta')
  })

  it('returns an empty object when both lookups fail', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    expect(await discoverEndpoints('example.net')).toEqual({})

    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(textResponse('', false))
    expect(await discoverEndpoints('example.net')).toEqual({})
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('recovers through the xml fallback when the json is malformed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error('bad json'))
    } as unknown as Response)
    fetchMock.mockResolvedValueOnce(textResponse(XRD))

    const endpoints = await discoverEndpoints('example.net')
    expect(endpoints.websocket).toBe('wss://example.net/xmpp-websocket')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips links without an href and unknown rels', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          links: [
            { rel: 'urn:xmpp:alt-connections:websocket' },
            { rel: 'http://example.net/unknown', href: 'https://example.net/x' }
          ]
        })
      )
      .mockResolvedValueOnce(
        textResponse(`<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
          <Link rel="urn:xmpp:alt-connections:xbosh" href="https://example.net/bosh"/>
        </XRD>`)
      )

    const endpoints = await discoverEndpoints('example.net')
    expect(endpoints).toEqual({ bosh: 'https://example.net/bosh' })
  })
})
