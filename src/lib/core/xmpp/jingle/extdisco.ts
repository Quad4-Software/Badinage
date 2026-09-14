// XEP-0215 external service discovery: ask our own server for the
// stun and turn relays it advertises. The result feeds straight into
// the WebRTC iceServers config - we never ship our own relay.

import { $iq } from 'strophe.js'

import type { XmppTransport } from '../features/transport'
import { childElements, firstNsTag } from '$lib/utils/xml'
import { jidDomain } from '$lib/utils/jid'
import { NS } from '../ns'

export interface ExtService {
  type: string
  host: string
  port?: string | undefined
  transport?: string | undefined
  username?: string | undefined
  password?: string | undefined
  expires?: string | undefined
}

// matches the RTCIceServer shape: under exactOptionalPropertyTypes the
// optional fields must not be assigned undefined explicitly
export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export function discoverServices(
  conn: XmppTransport,
  onDone: (services: ExtService[]) => void
): void {
  conn.sendIq(
    $iq({ type: 'get', to: jidDomain(conn.jid), id: conn.uniqueId('extdisco') }).c('services', {
      xmlns: NS.EXTDISCO
    }),
    (stanza) => {
      const servicesEl = firstNsTag(stanza, NS.EXTDISCO, 'services')
      if (!servicesEl) {
        onDone([])
        return
      }
      const services: ExtService[] = []
      for (const el of childElements(servicesEl)) {
        if (el.localName !== 'service') continue
        const host = el.getAttribute('host')
        const type = el.getAttribute('type')
        if (!host || !type) continue
        const service: ExtService = { type, host }
        for (const attr of ['port', 'transport', 'username', 'password', 'expires'] as const) {
          const value = el.getAttribute(attr)
          if (value) service[attr] = value
        }
        services.push(service)
      }
      onDone(services)
    },
    () => onDone([])
  )
}

// map extdisco services onto the RTCIceServer shape WebRTC expects.
// turn entries without credentials are kept anyway: some relays use
// ip-based auth, and a bad turn url only costs a failed gathering
export function servicesToIceServers(services: ExtService[]): IceServer[] {
  const out: IceServer[] = []
  for (const s of services) {
    const port = s.port ? `:${s.port}` : ''
    if (s.type === 'stun' || s.type === 'stuns') {
      out.push({ urls: `${s.type}:${s.host}${port}` })
    } else if (s.type === 'turn' || s.type === 'turns') {
      const transport = s.transport ? `?transport=${s.transport}` : ''
      const server: IceServer = { urls: `${s.type}:${s.host}${port}${transport}` }
      if (s.username) server.username = s.username
      if (s.password) server.credential = s.password
      out.push(server)
    }
  }
  return out
}
