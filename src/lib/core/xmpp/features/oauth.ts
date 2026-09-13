// XEP-0493 oauth client login: the probe half. The client connects to
// the XMPP server, offers an OAUTHBEARER attempt with an empty token,
// and reads the RFC 7628 JSON error document the server returns. Its
// openid-configuration field is the discovery URL for the authorization
// server, which may live on another host entirely (PocketID, Keycloak).
//
// The probe uses a dedicated throwaway strophe connection restricted to
// the OAUTHBEARER mechanism so the advertised mechanism list decides the
// outcome: no OAUTHBEARER offered means the server cannot do oauth
// login at all.

import { Strophe } from 'strophe.js'

import { OAUTH_PROBE_TIMEOUT_MS } from '$lib/constants'

export interface OauthProbe {
  supported: boolean
  // the oauth authorization server metadata url, when the server gave one
  discoveryUrl?: string | undefined
}

interface OAuthErrorDoc {
  'openid-configuration'?: unknown
  status?: unknown
}

// parses the RFC 7628 json error document out of either a decoded sasl
// challenge or a <failure/> element's text
export function parseOauthDiscovery(payload: string | null | undefined): string | undefined {
  if (!payload) return undefined
  let doc: OAuthErrorDoc
  try {
    doc = JSON.parse(payload) as OAuthErrorDoc
  } catch {
    return undefined
  }
  const url = doc['openid-configuration']
  return typeof url === 'string' && url.startsWith('https://') ? url : undefined
}

// whether the offered mechanism list contains OAUTHBEARER. Reads the
// stream:features element strophe stashes on conn.features
export function oauthAdvertised(features: Element | null | undefined): boolean {
  if (!features) return false
  for (const child of features.childNodes) {
    if (child.nodeType !== 1) continue
    const el = child as Element
    if (el.localName !== 'mechanisms') continue
    for (const mech of el.childNodes) {
      if (mech.nodeType === 1 && mech.textContent === 'OAUTHBEARER') return true
    }
  }
  return false
}

// Connect with an empty bearer token purely to harvest the discovery
// url. The server must answer with the json error doc. Whether it puts
// it in a challenge or in the failure body depends on the server, so
// both are captured.
export function probeOauthSupport(service: string, jid: string): Promise<OauthProbe> {
  return new Promise((resolve) => {
    let challengePayload: string | null = null
    let failurePayload: string | null = null
    let settled = false

    // strophe instantiates registered mechanisms itself. A shared slot
    // carries the captured challenge back out
    type Conn = InstanceType<typeof Strophe.Connection>
    class ProbeBearer extends Strophe.SASLOAuthBearer {
      override onChallenge(conn: Conn, challenge?: string) {
        if (challenge !== undefined) challengePayload = challenge
        return super.onChallenge(conn)
      }
    }

    const conn = new Strophe.Connection(service, { mechanisms: [ProbeBearer] })

    const finish = (result: OauthProbe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        conn.disconnect()
      } catch {
        // disconnect on a half-open socket is allowed to throw
      }
      resolve(result)
    }

    const timer = setTimeout(
      () => finish({ supported: oauthAdvertised(conn.features) }),
      OAUTH_PROBE_TIMEOUT_MS
    )

    try {
      conn.connect(jid, '', (status, _condition, elem) => {
        if (status === Strophe.Status.AUTHFAIL || status === Strophe.Status.CONNFAIL) {
          const text = elem?.textContent
          if (text?.includes('{')) failurePayload = text.trim()
        }
        if (
          status === Strophe.Status.AUTHFAIL ||
          status === Strophe.Status.DISCONNECTED ||
          status === Strophe.Status.CONNFAIL ||
          status === Strophe.Status.CONNTIMEOUT
        ) {
          const discoveryUrl =
            parseOauthDiscovery(challengePayload) ?? parseOauthDiscovery(failurePayload)
          finish({
            supported: oauthAdvertised(conn.features) || discoveryUrl !== undefined,
            discoveryUrl
          })
        }
        // a successful connect with an empty token would mean the server
        // accepted nothing as a credential. Treat it as unsupported
        else if (status === Strophe.Status.CONNECTED) {
          finish({ supported: oauthAdvertised(conn.features) })
        }
      })
    } catch {
      finish({ supported: false })
    }
  })
}
