// XEP-0077 in-band registration. Strophe cannot interpose between the
// stream-features dispatch and SASL: the pre-auth features handler calls
// authenticate() synchronously with no hook point, so an iq register
// round trip cannot be injected into its connect flow. Registration
// therefore runs on a dedicated throwaway websocket speaking just enough
// RFC 7395 framing to reach the features advertisement, then the socket
// is closed and the account logs in through the normal connection.

import { $iq, toStanza } from 'strophe.js'

import { REGISTER_TIMEOUT_MS } from '$lib/constants'
import { parseJid } from '$lib/utils/jid'

import { NS } from './ns'

const NS_FRAMING = 'urn:ietf:params:xml:ns:xmpp-framing'

// 'unsupported' and 'timeout' are client-side. Anything else is the stanza
// error condition the server sent (conflict, not-allowed, ...)
export type RegisterReason = 'unsupported' | 'timeout' | 'closed' | (string & {})

export class RegisterError extends Error {
  constructor(readonly reason: RegisterReason) {
    super(reason)
    this.name = 'RegisterError'
  }
}

// First element child of the iq <error> element names the condition.
function errorCondition(iq: Element): string {
  const error = iq.getElementsByTagName('error').item(0)
  if (!error) return 'error'
  for (const child of Array.from(error.childNodes)) {
    if (child.nodeType === 1) return (child as Element).localName
  }
  return 'error'
}

// Register a new account on the server behind the given websocket
// endpoint. Resolves once the server confirms. Rejects with RegisterError
// carrying a machine-readable reason.
export function registerAccount(service: string, jid: string, password: string): Promise<void> {
  const { local, domain } = parseJid(jid)
  return new Promise((resolve, reject) => {
    if (!local) {
      reject(new RegisterError('unsupported'))
      return
    }
    let done = false
    const ws = new WebSocket(service, 'xmpp')
    const finish = (err?: RegisterError) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`<close xmlns='${NS_FRAMING}'/>`)
        }
        ws.close()
      } catch {
        // the socket is already gone. The outcome stands
      }
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(() => finish(new RegisterError('timeout')), REGISTER_TIMEOUT_MS)

    const registerStanza = $iq({ type: 'set', to: domain, id: 'reg1' })
      .c('query', { xmlns: NS.REGISTER })
      .c('username')
      .t(local)
      .up()
      .c('password')
      .t(password)

    ws.onopen = () => {
      ws.send(`<open xmlns='${NS_FRAMING}' to='${domain}' version='1.0'/>`)
    }
    ws.onerror = () => finish(new RegisterError('closed'))
    ws.onclose = () => finish(new RegisterError('closed'))
    ws.onmessage = (event) => {
      // servers are entitled to send the <open> reply unclosed. Normalize
      // it so the frame always parses as a standalone element
      let raw = String(event.data)
      if (/^<open\s[^>]*[^/]>$/.test(raw)) raw = `${raw.slice(0, -1)}/>`
      let el: Element
      try {
        el = toStanza(raw)
      } catch {
        return
      }
      const name = el.localName
      if (name === 'open' || name === 'close') return
      if (name === 'features') {
        const advertised = el.getElementsByTagNameNS(NS.REGISTER_FEATURE, 'register')
        if (advertised.length === 0) {
          finish(new RegisterError('unsupported'))
        } else {
          ws.send(registerStanza.toString())
        }
        return
      }
      if (name === 'iq' && el.getAttribute('id') === 'reg1') {
        if (el.getAttribute('type') === 'result') finish()
        else finish(new RegisterError(errorCondition(el)))
      }
    }
  })
}
