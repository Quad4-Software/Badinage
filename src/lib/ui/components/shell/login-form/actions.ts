// Login form submit helpers, kept out of the component for the size
// gate: the synthetic irc jid, the registration error mapping, and the
// demo and SSO entry points that only need accounts state

import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import { accounts } from '$lib/state/accounts.svelte'
import { isWebSocketUrl } from '$lib/utils/url'

// the synthetic jid an irc login produces: nick@network-host. The
// host keeps same-nick accounts on different networks apart
export function ircJid(identity: string, server: string): string {
  const host = URL.parse(server)?.host.replace(':', '-') ?? 'irc.invalid'
  return `${identity}@${host}`
}

export function registerError(reason: string): string {
  const t = get(LL)
  if (reason === 'unsupported') return t.registerUnsupported()
  if (reason === 'conflict') return t.registerConflict()
  return t.registerFailed()
}

export async function demoLogin(): Promise<void> {
  await accounts.add({
    jid: 'demo@badinage.local',
    password: 'demo',
    demo: true
  })
}

// XEP-0493: probe the server for OAUTHBEARER, then hand the browser
// to the authorization endpoint. The callback resumes in App.svelte.
// Returns the error text to show, or null when the browser left for
// the identity provider
export async function ssoLogin(
  identity: string,
  server: string,
  remember: boolean,
  untrusted: boolean
): Promise<string | null> {
  const result = await accounts.startOAuth(identity, {
    websocketUrl: isWebSocketUrl(server) ? server : undefined,
    redirectUri: `${window.location.origin}/`,
    remember,
    untrusted
  })
  if (result.ok) {
    window.location.assign(result.url)
    return null
  }
  const t = get(LL)
  return result.reason === 'unsupported' ? t.oauthUnsupported() : t.oauthFailed()
}
