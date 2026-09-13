import type { Breadcrumb, ErrorEvent } from '@sentry/browser'
import { describe, expect, it } from 'vitest'

import { filterBreadcrumb, hasSensitiveData, scrubEvent, scrubText, scrubUrl } from './telemetry'

describe('scrubText', () => {
  it('redacts JID- and email-shaped addresses', () => {
    expect(scrubText('auth failed for user@example.org/laptop')).toBe(
      'auth failed for [redacted-address]'
    )
    expect(scrubText('room@conference.example.org and me@example.org')).toBe(
      '[redacted-address] and [redacted-address]'
    )
  })

  it('leaves text without addresses alone', () => {
    expect(scrubText('connection lost, retrying')).toBe('connection lost, retrying')
    expect(scrubText('meet @ noon')).toBe('meet @ noon')
  })
})

describe('scrubUrl', () => {
  it('strips credentials, query string and fragment', () => {
    expect(scrubUrl('https://user:pass@glitchtip.example.com/1?token=abc#frag')).toBe(
      'https://glitchtip.example.com/1'
    )
  })

  it('redacts addresses inside the url', () => {
    expect(scrubUrl('wss://example.org/xmpp?jid=me@example.org')).toBe('wss://example.org/xmpp')
    expect(scrubUrl('https://example.org/users/me@example.org')).toBe(
      'https://example.org/users/[redacted-address]'
    )
  })

  it('handles unparseable input', () => {
    expect(scrubUrl('not a url?x=1')).toBe('not a url')
  })
})

describe('hasSensitiveData', () => {
  it('flags stanza- and message-like keys', () => {
    expect(hasSensitiveData({ stanza: '<message/>' })).toBe(true)
    expect(hasSensitiveData({ from: 'me@example.org' })).toBe(true)
    expect(hasSensitiveData({ password: 'hunter2' })).toBe(true)
  })

  it('passes plain transport data', () => {
    expect(hasSensitiveData({ url: 'https://example.org', method: 'POST' })).toBe(false)
    expect(hasSensitiveData(undefined)).toBe(false)
    expect(hasSensitiveData({})).toBe(false)
  })
})

describe('filterBreadcrumb', () => {
  it('drops crumbs carrying stanza-like data fields', () => {
    const crumb: Breadcrumb = { category: 'xmpp', data: { stanza: '<presence/>' } }
    expect(filterBreadcrumb(crumb)).toBeNull()
  })

  it('drops crumbs whose message is raw stanza XML', () => {
    const crumb: Breadcrumb = {
      category: 'console',
      message: '<message from="me@example.org"><body>hi</body></message>'
    }
    expect(filterBreadcrumb(crumb)).toBeNull()
  })

  it('scrubs addresses and urls but keeps the crumb', () => {
    const crumb: Breadcrumb = {
      category: 'console',
      message: 'connected as me@example.org',
      data: { url: 'https://example.org/api?token=abc', status: 200 }
    }
    const out = filterBreadcrumb(crumb)
    expect(out).not.toBeNull()
    expect(out?.message).toBe('connected as [redacted-address]')
    expect(out?.data?.['url']).toBe('https://example.org/api')
    expect(out?.data?.['status']).toBe(200)
  })
})

describe('scrubEvent', () => {
  it('scrubs exception messages and drops user context', () => {
    const event = {
      type: undefined,
      message: 'sync failed for me@example.org',
      exception: {
        values: [{ type: 'Error', value: 'roster fetch failed for peer@example.org' }]
      },
      user: { id: 'me@example.org' }
    } as ErrorEvent
    const out = scrubEvent(event)
    expect(out.message).toBe('sync failed for [redacted-address]')
    expect(out.exception?.values?.[0]?.value).toBe('roster fetch failed for [redacted-address]')
    expect(out.user).toBeUndefined()
  })

  it('sanitizes request data', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://glitchtip.example.com/api/1/store/?key=abc',
        cookies: { session: 'x' },
        data: { secret: true },
        headers: {
          Cookie: 'session=x',
          Referer: 'https://app.example.org/chat?peer=me@example.org',
          'X-Peer': 'peer@example.org'
        }
      }
    } as ErrorEvent
    const out = scrubEvent(event)
    expect(out.request?.url).toBe('https://glitchtip.example.com/api/1/store/')
    expect(out.request?.cookies).toBeUndefined()
    expect(out.request?.data).toBeUndefined()
    expect(out.request?.headers?.['Cookie']).toBeUndefined()
    expect(out.request?.headers?.['Referer']).toBe('https://app.example.org/chat')
    expect(out.request?.headers?.['X-Peer']).toBe('[redacted-address]')
  })

  it('drops sensitive breadcrumbs attached to the event', () => {
    const event = {
      type: undefined,
      breadcrumbs: [
        { category: 'xmpp', data: { xml: '<iq/>' } },
        { category: 'console', message: 'ping' }
      ]
    } as ErrorEvent
    const out = scrubEvent(event)
    expect(out.breadcrumbs).toHaveLength(1)
    expect(out.breadcrumbs?.[0]?.message).toBe('ping')
  })
})
