import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchOAuthMetadata,
  OAuthError,
  pickScopes,
  refreshAccessToken,
  registerOAuthClient
} from './client'
import type { OAuthMetadata } from './client'
import { base64url, oauthState, pkcePair, randomUrlSafe } from './pkce'

const METADATA = {
  issuer: 'https://id.example.net',
  authorization_endpoint: 'https://id.example.net/authorize',
  token_endpoint: 'https://id.example.net/token',
  registration_endpoint: 'https://id.example.net/register',
  scopes_supported: ['openid', 'profile', 'xmpp']
}

function stubFetch(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pkce', () => {
  // RFC 7636 appendix B known-answer vector
  it('derives the S256 challenge from the verifier', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    expect(base64url(new Uint8Array(digest))).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates distinct url-safe values', async () => {
    const a = await pkcePair()
    const b = await pkcePair()
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(oauthState()).not.toBe(oauthState())
    expect(randomUrlSafe(8)).toHaveLength(11)
  })
})

describe('fetchOAuthMetadata', () => {
  it('parses an rfc 8414 document', async () => {
    stubFetch(METADATA)
    const metadata = await fetchOAuthMetadata('https://id.example.net/.well-known/oc')
    expect(metadata).toEqual({
      issuer: 'https://id.example.net',
      authorizationEndpoint: 'https://id.example.net/authorize',
      tokenEndpoint: 'https://id.example.net/token',
      registrationEndpoint: 'https://id.example.net/register',
      scopesSupported: ['openid', 'profile', 'xmpp']
    })
  })

  it('rejects incomplete documents and http errors', async () => {
    stubFetch({ issuer: 'https://id.example.net' })
    await expect(fetchOAuthMetadata('https://x.test')).rejects.toBeInstanceOf(OAuthError)
    stubFetch({}, { status: 500 })
    await expect(fetchOAuthMetadata('https://x.test')).rejects.toMatchObject({ code: 'network' })
  })
})

describe('pickScopes', () => {
  it('intersects wanted scopes with scopes_supported', () => {
    expect(pickScopes({ ...metadataBase(), scopesSupported: ['openid', 'email'] })).toEqual([
      'openid'
    ])
    expect(pickScopes({ ...metadataBase(), scopesSupported: ['xmpp'] })).toEqual(['xmpp'])
  })

  it('falls back to the oidc pair when the provider publishes nothing', () => {
    expect(pickScopes({ ...metadataBase(), scopesSupported: [] })).toEqual(['openid', 'profile'])
  })
})

function metadataBase(): OAuthMetadata {
  return {
    issuer: 'https://id.example.net',
    authorizationEndpoint: 'https://id.example.net/authorize',
    tokenEndpoint: 'https://id.example.net/token',
    scopesSupported: []
  }
}

describe('buildAuthorizeUrl', () => {
  it('carries code flow + pkce + state parameters', () => {
    const url = new URL(
      buildAuthorizeUrl(
        { ...metadataBase(), scopesSupported: [] },
        {
          clientId: 'c1',
          redirectUri: 'https://app.example.net/',
          state: 'st',
          challenge: 'ch',
          scopes: ['openid', 'profile']
        }
      )
    )
    expect(url.origin + url.pathname).toBe('https://id.example.net/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('c1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.net/')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('code_challenge')).toBe('ch')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid profile')
  })
})

describe('registerOAuthClient', () => {
  it('posts a dynamic registration and returns the client id', async () => {
    const fetchMock = stubFetch({ client_id: 'abc123' })
    const clientId = await registerOAuthClient(
      { ...metadataBase(), registrationEndpoint: 'https://id.example.net/register' },
      'https://app.example.net/',
      'Badinage'
    )
    expect(clientId).toBe('abc123')
    const init = fetchMock.mock.calls.at(0)?.[1]
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.redirect_uris).toEqual(['https://app.example.net/'])
    expect(body.token_endpoint_auth_method).toBe('none')
  })

  it('returns null when no registration endpoint exists', async () => {
    expect(
      await registerOAuthClient(metadataBase(), 'https://app.example.net/', 'Badinage')
    ).toBeNull()
  })
})

describe('token endpoint calls', () => {
  it('exchanges the code with the pkce verifier', async () => {
    const fetchMock = stubFetch({ access_token: 'at', refresh_token: 'rt', expires_in: 60 })
    const tokens = await exchangeCode(metadataBase(), {
      code: 'code1',
      verifier: 'v',
      clientId: 'c1',
      redirectUri: 'https://app.example.net/'
    })
    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
    const body = String(fetchMock.mock.calls.at(0)?.[1]?.body)
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code_verifier=v')
  })

  it('refreshes with the refresh token', async () => {
    const fetchMock = stubFetch({ access_token: 'at2' })
    const tokens = await refreshAccessToken(metadataBase(), {
      refreshToken: 'rt',
      clientId: 'c1'
    })
    expect(tokens.accessToken).toBe('at2')
    expect(String(fetchMock.mock.calls.at(0)?.[1]?.body)).toContain('grant_type=refresh_token')
  })

  it('surfaces an oauth error reply as denied', async () => {
    stubFetch({ error: 'invalid_grant' })
    await expect(
      refreshAccessToken(metadataBase(), { refreshToken: 'rt', clientId: 'c1' })
    ).rejects.toMatchObject({ code: 'denied' })
  })

  it('rejects a reply without an access token', async () => {
    stubFetch({ token_type: 'bearer' })
    await expect(
      exchangeCode(metadataBase(), {
        code: 'c',
        verifier: 'v',
        clientId: 'c1',
        redirectUri: 'https://app.example.net/'
      })
    ).rejects.toMatchObject({ code: 'invalid' })
  })
})
