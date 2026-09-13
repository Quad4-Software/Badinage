import { DOMParser } from '@xmldom/xmldom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CAPS_NODE, DISCO_NEGATIVE_TTL_MS, DISCO_TIMEOUT_MS } from '$lib/constants'

import { NS } from '../ns'
import {
  answerDiscoInfo,
  answerDiscoItems,
  capsVerificationString,
  discoInfo,
  discoItems,
  ownCaps
} from './disco'
import type { StanzaBuilder, XmppTransport } from './transport'

const parser = new DOMParser()

function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  return doc as unknown as Element
}

interface IqCall {
  stanza: StanzaBuilder
  onResult: (stanza: Element) => void
  onError: (stanza: Element | null) => void
}

function makeTransport(): { conn: XmppTransport; iqs: IqCall[]; sent: StanzaBuilder[] } {
  const iqs: IqCall[] = []
  const sent: StanzaBuilder[] = []
  const conn: XmppTransport = {
    sendIq: (stanza, onResult, onError) => {
      iqs.push({ stanza, onResult, onError: onError ?? (() => undefined) })
    },
    send: (stanza) => sent.push(stanza),
    uniqueId: (prefix) => `${prefix}-1`,
    jid: 'me@example.net/res'
  }
  return { conn, iqs, sent }
}

const INFO_RESULT = `<iq type="result"><query xmlns="${NS.DISCO_INFO}">
  <identity category="client" type="web" name="Other"/>
  <feature var="${NS.MUC}"/>
</query></iq>`

describe('capsVerificationString', () => {
  // XEP-0115 section 5.2 simple generation example
  it('matches the XEP-0115 known-answer vector', () => {
    const ver = capsVerificationString(
      [{ category: 'client', type: 'pc', name: 'Exodus 0.9.1' }],
      [
        'http://jabber.org/protocol/muc',
        'http://jabber.org/protocol/disco#info',
        'http://jabber.org/protocol/caps',
        'http://jabber.org/protocol/disco#items'
      ]
    )
    expect(ver).toBe('QgayPKawpkPSDYmwT/WM94uAlu0=')
  })

  // XEP-0115 section 5.3 complex example: two identities sorted by
  // lang, one data form with multi-value fields
  it('matches the XEP-0115 complex generation example', () => {
    const ver = capsVerificationString(
      [
        { category: 'client', type: 'pc', name: 'Psi 0.11', lang: 'en' },
        { category: 'client', type: 'pc', name: 'Ψ 0.11', lang: 'el' }
      ],
      [
        'http://jabber.org/protocol/caps',
        'http://jabber.org/protocol/disco#info',
        'http://jabber.org/protocol/disco#items',
        'http://jabber.org/protocol/muc'
      ],
      [
        {
          formType: 'urn:xmpp:dataforms:softwareinfo',
          fields: [
            { var: 'os', values: ['Mac'] },
            { var: 'ip_version', values: ['ipv6', 'ipv4'] },
            { var: 'software_version', values: ['0.11'] },
            { var: 'software', values: ['Psi'] },
            { var: 'os_version', values: ['10.5.1'] }
          ]
        }
      ]
    )
    expect(ver).toBe('q07IKJEyjvHSyhy//CH0CxmKi8w=')
  })

  it('changes when the feature set changes', () => {
    const base = capsVerificationString(
      [{ category: 'client', type: 'web', name: 'Badinage' }],
      ['a', 'b']
    )
    const extra = capsVerificationString(
      [{ category: 'client', type: 'web', name: 'Badinage' }],
      ['a', 'b', 'c']
    )
    expect(base).not.toBe(extra)
  })
})

describe('ownCaps', () => {
  it('is stable across calls and uses sha-1', () => {
    const first = ownCaps()
    expect(first.hash).toBe('sha-1')
    expect(first.node).toBe(CAPS_NODE)
    expect(first.ver).toBe(ownCaps().ver)
  })
})

describe('discoInfo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('dedupes in-flight queries and caches the result', () => {
    const { conn, iqs } = makeTransport()
    const first = vi.fn()
    const second = vi.fn()
    discoInfo(conn, 'peer@example.net', undefined, first)
    discoInfo(conn, 'peer@example.net', undefined, second)
    expect(iqs).toHaveLength(1)
    iqs[0]?.onResult(xml(INFO_RESULT))
    for (const cb of [first, second]) {
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ features: [NS.MUC] })
      )
    }
    // a later query is served from the session cache without a new iq
    const third = vi.fn()
    discoInfo(conn, 'peer@example.net', undefined, third)
    expect(iqs).toHaveLength(1)
    expect(third).toHaveBeenCalled()
  })

  it('serves failures from the negative cache until the ttl passes', () => {
    vi.useFakeTimers()
    const { conn, iqs } = makeTransport()
    const first = vi.fn()
    discoInfo(conn, 'dead@example.net', undefined, first)
    iqs[0]?.onError(null)
    expect(first).toHaveBeenCalledWith(null)

    const second = vi.fn()
    discoInfo(conn, 'dead@example.net', undefined, second)
    expect(iqs).toHaveLength(1)
    expect(second).toHaveBeenCalledWith(null)

    vi.advanceTimersByTime(DISCO_NEGATIVE_TTL_MS + 1)
    discoInfo(conn, 'dead@example.net', undefined, vi.fn())
    expect(iqs).toHaveLength(2)
  })

  it('times out unresponsive jids and caches the failure', () => {
    vi.useFakeTimers()
    const { conn, iqs } = makeTransport()
    const done = vi.fn()
    discoInfo(conn, 'silent@example.net', undefined, done)
    vi.advanceTimersByTime(DISCO_TIMEOUT_MS + 1)
    expect(done).toHaveBeenCalledWith(null)
    discoInfo(conn, 'silent@example.net', undefined, vi.fn())
    expect(iqs).toHaveLength(1)
  })

  it('passes the node through for caps node#ver queries', async () => {
    const { conn, iqs } = makeTransport()
    const done = vi.fn()
    discoInfo(conn, 'peer@example.net', 'https://x.example/caps#abc=', done)
    // no indexedDB in the test env: the caps cache misses and the wire
    // query goes out on a microtask
    await vi.waitFor(() => expect(iqs).toHaveLength(1))
    expect(String(iqs[0]?.stanza)).toContain('node="https://x.example/caps#abc="')
    iqs[0]?.onResult(xml(INFO_RESULT))
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ features: [NS.MUC] }))
  })
})

describe('discoItems', () => {
  it('parses and caches items results', () => {
    const { conn, iqs } = makeTransport()
    const done = vi.fn()
    discoItems(conn, 'example.net', done)
    iqs[0]?.onResult(
      xml(`<iq type="result"><query xmlns="${NS.DISCO_ITEMS}">
        <item jid="upload.example.net" name="Uploads"/>
      </query></iq>`)
    )
    expect(done).toHaveBeenCalledWith([
      { jid: 'upload.example.net', node: undefined, name: 'Uploads' }
    ])
    discoItems(conn, 'example.net', vi.fn())
    expect(iqs).toHaveLength(1)
  })
})

describe('answerDiscoInfo', () => {
  it('replies with our identity and the feature registry', () => {
    const { conn, sent } = makeTransport()
    const handled = answerDiscoInfo(
      conn,
      xml(`<iq type="get" id="d1" from="peer@example.net/x">
        <query xmlns="${NS.DISCO_INFO}"/>
      </iq>`)
    )
    expect(handled).toBe(true)
    const reply = String(sent[0])
    expect(reply).toContain('type="result"')
    expect(reply).toContain('id="d1"')
    expect(reply).toContain('to="peer@example.net/x"')
    expect(reply).toContain('category="client"')
    expect(reply).toContain('type="web"')
    expect(reply).toContain(`var="${NS.BOOKMARKS}"`)
    expect(reply).toContain(`var="${NS.BOOKMARKS}+notify"`)
  })

  it('serves the query for our own caps node#ver', () => {
    const { conn, sent } = makeTransport()
    const node = `${CAPS_NODE}#${ownCaps().ver}`
    answerDiscoInfo(
      conn,
      xml(`<iq type="get" id="d2" from="peer@example.net">
        <query xmlns="${NS.DISCO_INFO}" node="${node}"/>
      </iq>`)
    )
    const reply = String(sent[0])
    expect(reply).toContain('type="result"')
    expect(reply).toContain(`node="${node}"`)
  })

  it('rejects unknown nodes with item-not-found', () => {
    const { conn, sent } = makeTransport()
    answerDiscoInfo(
      conn,
      xml(`<iq type="get" id="d3" from="peer@example.net">
        <query xmlns="${NS.DISCO_INFO}" node="http://other.example#zzz"/>
      </iq>`)
    )
    const reply = String(sent[0])
    expect(reply).toContain('type="error"')
    expect(reply).toContain('item-not-found')
  })
})

describe('answerDiscoItems', () => {
  it('replies with an empty item list', () => {
    const { conn, sent } = makeTransport()
    answerDiscoItems(
      conn,
      xml(`<iq type="get" id="d4" from="peer@example.net">
        <query xmlns="${NS.DISCO_ITEMS}"/>
      </iq>`)
    )
    const reply = String(sent[0])
    expect(reply).toContain('type="result"')
    expect(reply).toContain(`xmlns="${NS.DISCO_ITEMS}"`)
    expect(reply).not.toContain('<item')
  })
})
