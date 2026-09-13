import { DOMParser } from '@xmldom/xmldom'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { malformed, messageArb, presenceArb, stanzaArb } from '../../../../test/stanza-gen'
import { NS } from './ns'
import {
  hasDiscoFeature,
  parseAvatarHash,
  parseBlockPush,
  parseBookmark,
  parseBookmarkItems,
  parseCaps,
  parseDiscoInfo,
  parseDiscoItems,
  parseJidItems,
  parseMamFin,
  parseMessage,
  parsePepEvent,
  parsePresence,
  parseRosterItems,
  parseUploadSlot,
  parseVcardPhoto
} from './stanzas'

const parser = new DOMParser()
const noop = (): void => undefined
const tolerantParser = new DOMParser({ onError: noop })

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  return doc as unknown as Element
}

function tryXml(markup: string): Element | null {
  try {
    const doc = tolerantParser.parseFromString(markup, 'application/xml').documentElement
    return (doc ?? null) as unknown as Element | null
  } catch {
    return null
  }
}

function runReadOnlyParsers(el: Element): void {
  parseRosterItems(el)
  parseJidItems(el)
  parseBlockPush(el)
  parseDiscoItems(el)
  parseDiscoInfo(el)
  parseCaps(el)
  parseAvatarHash(el)
  parsePepEvent(el)
  parseBookmark(el)
  parseBookmarkItems(el)
  hasDiscoFeature(el, NS.HTTP_UPLOAD)
  hasDiscoFeature(el, 'urn:xmpp:never')
  parseUploadSlot(el)
  parseVcardPhoto(el)
  parseMamFin(el)
  parsePresence(el)
}

describe('property: structured stanzas', () => {
  it('parse functions never throw on generated stanzas', () => {
    fc.assert(
      fc.property(stanzaArb, (s) => {
        const el = xml(s.xml)
        runReadOnlyParsers(el)
        parseMessage(el)
      })
    )
  })

  it('parseMessage output satisfies its contract', () => {
    fc.assert(
      fc.property(messageArb, (s) => {
        const m = parseMessage(xml(s.xml))
        if (!m) return
        expect(m.type === 'chat' || m.type === 'groupchat').toBe(true)
        expect(typeof m.from).toBe('string')
        expect(typeof m.to).toBe('string')
        expect(typeof m.body).toBe('string')
        const meaningful = Boolean(
          m.body ||
          m.chatState ||
          m.receiptFor ||
          m.marker ||
          m.reactionTo ||
          m.attachments?.length ||
          m.encryptedXml ||
          m.subject !== undefined
        )
        expect(meaningful).toBe(true)
        if (s.stanzaId !== undefined) expect(m.stanzaId).toBe(s.stanzaId)
        if (s.delayStamp !== undefined) {
          const expected = Date.parse(s.delayStamp)
          if (!Number.isNaN(expected)) expect(m.delay).toBe(expected)
        }
      })
    )
  })

  it('parsePresence returns a known kind or null', () => {
    fc.assert(
      fc.property(presenceArb, (s) => {
        const p = parsePresence(xml(s.xml))
        if (p) expect(['occupant', 'subscribe', 'presence', 'presenceError']).toContain(p.kind)
      })
    )
  })
})

describe('property: malformed input', () => {
  it('parse functions never throw on garbage or mutated stanzas', () => {
    fc.assert(
      fc.property(malformed, (s) => {
        const el = tryXml(s)
        if (!el) return
        runReadOnlyParsers(el)
        parseMessage(el)
      })
    )
  })
})
