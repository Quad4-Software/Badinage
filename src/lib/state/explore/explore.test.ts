import { describe, expect, it, vi } from 'vitest'

import type { ChatConnection } from '$lib/core/xmpp/connection'
import { CHANNEL_SEARCH_FEATURE } from '$lib/core/xmpp/features/search'
import type { DiscoInfo, DiscoItem } from '$lib/core/xmpp/stanzas'

import type { Account } from '../accounts.svelte'
import { ExploreStore, fallbackSearchForm } from './explore.svelte'

// a connection whose disco surface is scripted per jid; everything else
// is irrelevant to the explore store
function fakeConnection(opts: {
  items?: DiscoItem[] | null
  features?: Record<string, string[]>
}): ChatConnection {
  return {
    discoItems: vi.fn((_jid: string, onDone: (items: DiscoItem[] | null) => void) => {
      onDone(opts.items ?? [])
    }),
    discoInfo: vi.fn(
      (jid: string, _node: string | undefined, onDone: (info: DiscoInfo | null) => void) => {
        const features = opts.features?.[jid]
        onDone(features ? { identities: [], features, forms: [] } : null)
      }
    )
  } as unknown as ChatConnection
}

function fakeAccount(connection: ChatConnection): Account {
  return { jid: 'me@example.net', connection } as unknown as Account
}

describe('fallbackSearchForm', () => {
  it('carries the FORM_TYPE marker and a q field', () => {
    const form = fallbackSearchForm()
    const formType = form.fields.find((field) => field.var === 'FORM_TYPE')
    expect(formType?.type).toBe('hidden')
    // the hidden marker keeps a value so channelSearch submits it back
    expect(formType?.values).toEqual(['urn:xmpp:channel-search:0:search-params'])
    const q = form.fields.find((field) => field.var === 'q')
    expect(q?.type).toBe('text-single')
  })
})

describe('ExploreStore discoverSearchService', () => {
  it('picks the first disco item advertising the search feature', () => {
    const connection = fakeConnection({
      items: [{ jid: 'muc.example.net' }, { jid: 'search.example.net' }],
      features: { 'search.example.net': [CHANNEL_SEARCH_FEATURE] }
    })
    const store = new ExploreStore()
    let found: string | null = 'unset'
    store.discoverSearchService(fakeAccount(connection), (service) => {
      found = service
    })
    expect(found).toBe('search.example.net')
  })

  it('probes conference.<domain> when items discovery finds nothing', () => {
    const connection = fakeConnection({
      items: [],
      features: { 'conference.example.net': [CHANNEL_SEARCH_FEATURE] }
    })
    const store = new ExploreStore()
    let found: string | null = 'unset'
    store.discoverSearchService(fakeAccount(connection), (service) => {
      found = service
    })
    expect(found).toBe('conference.example.net')
  })

  it('resolves null when no candidate runs the protocol', () => {
    const connection = fakeConnection({ items: [{ jid: 'muc.example.net' }] })
    const store = new ExploreStore()
    let found: string | null = 'unset'
    store.discoverSearchService(fakeAccount(connection), (service) => {
      found = service
    })
    expect(found).toBeNull()
  })

  it('caches the resolution per account for the session', () => {
    const connection = fakeConnection({
      items: [],
      features: { 'conference.example.net': [CHANNEL_SEARCH_FEATURE] }
    })
    const store = new ExploreStore()
    const account = fakeAccount(connection)
    const noop = () => undefined
    store.discoverSearchService(account, noop)
    store.discoverSearchService(account, noop)
    expect(connection.discoItems).toHaveBeenCalledTimes(1)
  })
})
