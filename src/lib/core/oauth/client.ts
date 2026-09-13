// The http half of XEP-0493 oauth client login: RFC 8414 metadata
// discovery, RFC 7591 dynamic registration, the authorize redirect and
// the token endpoint calls. Everything here is DOM-free so it stays
// unit-testable and usable from a worker.

import { OAUTH_HTTP_TIMEOUT_MS } from '$lib/constants'

export interface OAuthMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string | undefined
  scopesSupported: string[]
}

interface RawMetadata {
  issuer?: unknown
  authorization_endpoint?: unknown
  token_endpoint?: unknown
  registration_endpoint?: unknown
  scopes_supported?: unknown
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: 'network' | 'invalid' | 'denied' | 'unsupported' = 'network'
  ) {
    super(message)
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), OAUTH_HTTP_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) throw new OAuthError(`oauth http ${res.status}`, 'network')
    return (await res.json()) as unknown
  } catch (err) {
    if (err instanceof OAuthError) throw err
    throw new OAuthError(err instanceof Error ? err.message : 'oauth request failed')
  } finally {
    clearTimeout(timer)
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

// RFC 8414 (and OIDC discovery, which shares the document shape). The
// issuer must match the document's issuer claim so a poisoned URL cannot
// redirect authorization elsewhere.
export async function fetchOAuthMetadata(discoveryUrl: string): Promise<OAuthMetadata> {
  const raw = (await fetchJson(discoveryUrl)) as RawMetadata
  const metadata: OAuthMetadata = {
    issuer: str(raw.issuer) ?? '',
    authorizationEndpoint: str(raw.authorization_endpoint) ?? '',
    tokenEndpoint: str(raw.token_endpoint) ?? '',
    registrationEndpoint: str(raw.registration_endpoint),
    scopesSupported: Array.isArray(raw.scopes_supported)
      ? raw.scopes_supported.filter((s): s is string => typeof s === 'string')
      : []
  }
  if (!metadata.issuer || !metadata.authorizationEndpoint || !metadata.tokenEndpoint) {
    throw new OAuthError('oauth discovery document is incomplete', 'invalid')
  }
  return metadata
}

// RFC 7591 dynamic registration. Returns null when the provider does not
// offer a registration endpoint; the caller then falls back to the
// configured default client id or fails.
export async function registerOAuthClient(
  metadata: OAuthMetadata,
  redirectUri: string,
  clientName: string
): Promise<string | null> {
  if (!metadata.registrationEndpoint) return null
  const raw = (await fetchJson(metadata.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web'
    })
  })) as { client_id?: unknown }
  const clientId = str(raw.client_id)
  if (!clientId) throw new OAuthError('oauth registration returned no client_id', 'invalid')
  return clientId
}

// Scopes we ask for when the provider advertises them. openid/profile
// satisfy OIDC providers (PocketID, Keycloak); xmpp is the scope prosody
// registers. Providers that publish no scopes_supported get the OIDC
// default pair only.
const WANTED_SCOPES = ['openid', 'profile', 'xmpp']
const DEFAULT_SCOPES = ['openid', 'profile']

export function pickScopes(metadata: OAuthMetadata): string[] {
  if (metadata.scopesSupported.length === 0) return DEFAULT_SCOPES
  const picked = WANTED_SCOPES.filter((s) => metadata.scopesSupported.includes(s))
  return picked.length > 0 ? picked : DEFAULT_SCOPES
}

export function buildAuthorizeUrl(
  metadata: OAuthMetadata,
  params: {
    clientId: string
    redirectUri: string
    state: string
    challenge: string
    scopes?: string[] | undefined
    loginHint?: string | undefined
  }
): string {
  const url = new URL(metadata.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('scope', (params.scopes ?? pickScopes(metadata)).join(' '))
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint)
  return url.toString()
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string | undefined
  expiresAt?: number | undefined
}

interface RawTokenReply {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  error?: unknown
}

async function tokenRequest(
  metadata: OAuthMetadata,
  form: Record<string, string>
): Promise<OAuthTokens> {
  const raw = (await fetchJson(metadata.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })) as RawTokenReply
  if (typeof raw.error === 'string')
    throw new OAuthError(`oauth token error: ${raw.error}`, 'denied')
  const accessToken = str(raw.access_token)
  if (!accessToken) throw new OAuthError('oauth token reply carried no access_token', 'invalid')
  return {
    accessToken,
    refreshToken: str(raw.refresh_token),
    expiresAt: typeof raw.expires_in === 'number' ? Date.now() + raw.expires_in * 1000 : undefined
  }
}

export function exchangeCode(
  metadata: OAuthMetadata,
  params: { code: string; verifier: string; clientId: string; redirectUri: string }
): Promise<OAuthTokens> {
  return tokenRequest(metadata, {
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.verifier
  })
}

export function refreshAccessToken(
  metadata: OAuthMetadata,
  params: { refreshToken: string; clientId: string }
): Promise<OAuthTokens> {
  return tokenRequest(metadata, {
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId
  })
}
