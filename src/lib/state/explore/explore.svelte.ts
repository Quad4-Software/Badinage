// XEP-0433 extended channel search backing the explore-rooms dialog:
// discovers a search service on the account domain, fetches the search
// form it offers, and submits filled searches through the connection.

import type { ChatConnection } from '$lib/core/xmpp/connection'
import { CHANNEL_SEARCH_FEATURE } from '$lib/core/xmpp/features/search'
import type { ChannelSearchItem, DataForm, DataFormField } from '$lib/core/xmpp/stanzas'
import { bareJid, jidDomain } from '$lib/utils/jid'

import type { Account } from '../accounts.svelte'

// a generous service could return hundreds of rooms. The result list is
// capped so the dialog stays responsive
const RESULT_CAP = 50

// FORM_TYPE marking a XEP-0433 search-params form. The synthetic
// fallback stamps it so the service sees a well-formed submission
const SEARCH_PARAMS_FORM_TYPE = 'urn:xmpp:channel-search:0:search-params'

// dialog error kinds, mapped to i18n strings by the component
type ExploreError = 'missing' | 'failed'

// Used when the service answers the form request without a usable data
// form: the mandatory q field plus the FORM_TYPE marker.
export function fallbackSearchForm(): DataForm {
  return {
    fields: [
      {
        var: 'FORM_TYPE',
        type: 'hidden',
        required: false,
        values: [SEARCH_PARAMS_FORM_TYPE],
        options: []
      },
      { var: 'q', type: 'text-single', required: false, values: [], options: [] }
    ]
  }
}

export class ExploreStore {
  // the dialog binds this flag. It lives here rather than app.svelte.ts
  // so the explore vertical stays self-contained
  open = $state(false)
  // room address picked from the results. The join-room dialog reads
  // and clears this slot on open to prefill its room field. That wiring
  // lives in the join flow, this is only the handoff.
  joinPrefill = $state<{ room: string } | null>(null)

  // service jid, bound to the dialog's service input
  service = $state('')
  // the fetched (or synthetic fallback) search form. Fields beyond the
  // hidden FORM_TYPE and q are rendered by the dialog as generic inputs
  form = $state<DataForm | null>(null)
  results = $state<ChannelSearchItem[]>([])
  loading = $state(false)
  error = $state<ExploreError | null>(null)
  // tells an answered-with-nothing search apart from never-searched
  searched = $state(false)

  // resolved search service per account bare jid for the session. A
  // null entry caches a miss so reopening skips the disco walk.
  // bookkeeping only, nothing renders off it
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private services = new Map<string, string | null>()
  // callbacks stacked while a discovery for the same account is in
  // flight, so a reopen does not fan out a second disco walk
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private pending = new Map<string, ((service: string | null) => void)[]>()
  // service the current form was fetched for. An edited service input
  // triggers a refetch before the search goes out
  private formService = ''
  // captured on discovery. FetchForm and search reach the transport
  // through it instead of re-resolving the active account
  private connection: ChatConnection | null = null
  // monotonic id guarding against a slower earlier search overwriting
  // the results of the newest one
  private searchSeq = 0

  // searchable fields the dialog renders: everything except the hidden
  // FORM_TYPE marker and q, which has its own query input
  get fields(): DataFormField[] {
    return (this.form?.fields ?? []).filter(
      (field) => field.type !== 'hidden' && field.var !== 'FORM_TYPE' && field.var !== 'q'
    )
  }

  // clears per-open state. The resolved-service cache survives
  reset(): void {
    this.service = ''
    this.form = null
    this.results = []
    this.loading = false
    this.error = null
    this.searched = false
    this.formService = ''
  }

  // XEP-0030 walk over the account domain: the first disco item whose
  // info advertises the channel-search feature wins. conference.<domain>
  // is probed as well, the conventional fallback for when items
  // discovery finds nothing. The resolution is cached per account.
  discoverSearchService(account: Account, onDone: (service: string | null) => void): void {
    this.connection = account.connection
    const key = bareJid(account.jid)
    if (this.services.has(key)) {
      onDone(this.services.get(key) ?? null)
      return
    }
    const waiters = this.pending.get(key)
    if (waiters) {
      waiters.push(onDone)
      return
    }
    this.pending.set(key, [onDone])
    const finish = (service: string | null) => {
      this.services.set(key, service)
      const callbacks = this.pending.get(key) ?? []
      this.pending.delete(key)
      for (const callback of callbacks) callback(service)
    }
    const domain = jidDomain(account.jid)
    account.connection.discoItems(domain, (items) => {
      const candidates = (items ?? []).map((item) => item.jid)
      const fallback = `conference.${domain}`
      if (!candidates.includes(fallback)) candidates.push(fallback)
      const step = (index: number) => {
        const jid = candidates[index]
        if (jid === undefined) {
          finish(null)
          return
        }
        account.connection.discoInfo(jid, undefined, (info) => {
          if (info?.features.includes(CHANNEL_SEARCH_FEATURE)) {
            finish(jid)
          } else {
            step(index + 1)
          }
        })
      }
      step(0)
    })
  }

  // Fetch the service's search form. A null answer installs the
  // synthetic q-only fallback so the search iq still goes out.
  fetchForm(service: string): void {
    const connection = this.connection
    if (!connection || !service) return
    this.formService = service
    connection.channelSearchForm(service, (form) => {
      // a slower fetch for a service the user has since retyped loses
      if (this.formService !== service) return
      this.form = this.normalize(form ?? fallbackSearchForm())
    })
  }

  // Submit the form with q set to the query. When the service input no
  // longer matches the fetched form, the form is refetched first so the
  // submission fits the service actually being searched.
  search(service: string, query: string): void {
    const connection = this.connection
    if (!connection || !service) return
    this.error = null
    this.loading = true
    const seq = ++this.searchSeq
    const submit = () => {
      const form = this.form ?? fallbackSearchForm()
      this.form = form
      let q = form.fields.find((field) => field.var === 'q')
      if (!q) {
        // a form without the mandatory field still gets one appended so
        // the typed query reaches the service
        q = { var: 'q', type: 'text-single', required: false, values: [], options: [] }
        form.fields.push(q)
      }
      q.values = [query]
      connection.channelSearch(service, form, (items) => {
        // a newer search already went out. Its answer wins
        if (seq !== this.searchSeq) return
        this.loading = false
        this.searched = true
        if (items === null) {
          this.results = []
          this.error = 'failed'
          return
        }
        this.results = items.slice(0, RESULT_CAP)
      })
    }
    if (this.form && this.formService === service) {
      submit()
      return
    }
    this.formService = service
    connection.channelSearchForm(service, (form) => {
      if (this.formService !== service) {
        this.loading = false
        return
      }
      this.form = this.normalize(form ?? fallbackSearchForm())
      submit()
    })
  }

  // a required list-single with no value gets its first option seeded
  // so the rendered select matches what is submitted
  private normalize(form: DataForm): DataForm {
    for (const field of form.fields) {
      const first = field.options[0]
      if (field.type === 'list-single' && field.required && field.values.length === 0 && first) {
        field.values = [first.value]
      }
    }
    return form
  }
}

export const explore = new ExploreStore()
