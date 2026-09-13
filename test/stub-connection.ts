// Test harness for XmppConnection: a real Strophe.Connection whose wire
// methods are replaced by spies, so the connection can be driven through
// its status callback without any IO. Lives outside src/ so it stays out
// of coverage accounting.

import { DOMParser } from '@xmldom/xmldom'
import { Strophe } from 'strophe.js'
import type { ConnectCallback } from 'strophe.js'
import { vi } from 'vitest'

import { XmppConnection } from '$lib/core/xmpp/connection'

const parser = new DOMParser()

export function xml(markup: string): Element {
  const doc = parser.parseFromString(markup, 'application/xml').documentElement
  if (!doc) throw new Error('bad test xml')
  // xmldom's Element type is structural enough for the stanza parsers
  return doc as unknown as Element
}

export type Conn = InstanceType<typeof Strophe.Connection>
export type HandlerFn = (stanza: Element) => boolean

export function makeStub() {
  const conn = new Strophe.Connection('ws://127.0.0.1:1/xmpp-websocket')
  let statusCb: ConnectCallback | undefined

  const connect = vi.fn<Conn['connect']>((jid, pass, callback) => {
    statusCb = callback
    conn.jid = jid
    conn.pass = pass
  })
  const disconnect = vi.fn<Conn['disconnect']>()
  const send = vi.fn<Conn['send']>()
  const sendIQ = vi.fn<Conn['sendIQ']>(() => 'iq-1')
  const addHandler = vi.fn<Conn['addHandler']>(
    () => null as unknown as ReturnType<Conn['addHandler']>
  )
  const getUniqueId = vi.fn<Conn['getUniqueId']>((suffix) => `${String(suffix)}-1`)

  conn.connect = connect
  conn.disconnect = disconnect
  conn.send = send
  conn.sendIQ = sendIQ
  conn.addHandler = addHandler
  conn.getUniqueId = getUniqueId

  const xmpp = new XmppConnection('ws://127.0.0.1:1/xmpp-websocket', conn)

  const drive = (status: number) => {
    if (!statusCb) throw new Error('connect callback was not captured')
    // strophe sets conn.connected before the CONNECTED callback and
    // stashes the stream:features element on conn.features. The stub
    // mirrors both so feature-gated sends behave like the wire
    conn.connected = status === Strophe.Status.CONNECTED || status === Strophe.Status.ATTACHED
    if (conn.connected && !conn.features) {
      conn.features = xml(
        `<stream:features xmlns:stream='http://etherx.jabber.org/streams'>` +
          `<bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/>` +
          `<carbons xmlns='urn:xmpp:carbons:2'/>` +
          `<csi xmlns='urn:xmpp:csi:0'/>` +
          `</stream:features>`
      )
    }
    statusCb(status, null)
  }

  return { conn, xmpp, connect, disconnect, send, sendIQ, addHandler, drive }
}

export function findHandler(
  stub: ReturnType<typeof makeStub>,
  name: string | null,
  ns: string | null = null
): HandlerFn {
  const call = stub.addHandler.mock.calls.find((c) => c[2] === name && c[1] === ns)
  if (!call) throw new Error(`no handler registered for ${name}/${ns}`)
  return call[0]
}
