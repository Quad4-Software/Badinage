// AccountsStore: the multi-account collection. Owns add/register/oauth
// flows, removal teardown and switcher ordering. The Account model lives
// in account.svelte.ts next door.

import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchOAuthMetadata,
  OAuthError,
  pickScopes,
  registerOAuthClient,
  refreshAccessToken
} from '$lib/core/oauth/client'
import { oauthState, pkcePair } from '$lib/core/oauth/pkce'
import {
  clearOAuthTokens,
  loadOAuthClientId,
  loadOAuthTokens,
  saveOAuthClientId,
  saveOAuthTokens,
  savePendingFlow,
  takePendingFlow
} from '$lib/core/oauth/session'
import { clearSession, saveSession } from '$lib/core/storage/session'
import { discoverEndpoints } from '$lib/core/xmpp/discovery'
import { probeOauthSupport } from '$lib/core/xmpp/features/oauth'
import { RegisterError, registerAccount } from '$lib/core/xmpp/register'
import { bareJid, jidDomain } from '$lib/utils/jid'
import { settings } from '$lib/state/settings.svelte'
import { deleteAccountData } from '$lib/state/storage'

import { Account, type AccountOptions } from './account.svelte'

class AccountsStore {
  list = $state<Account[]>([])
  activeJid = $state<string | null>(null)

  private removeListeners: ((jid: string) => void | Promise<void>)[] = []

  // subscribers get a chance to flush and unbind before the account
  // leaves the list. Returned promises are awaited before data deletion
  onRemoved(fn: (jid: string) => void | Promise<void>): void {
    this.removeListeners.push(fn)
  }

  get active(): Account | undefined {
    return this.list.find((a) => a.jid === this.activeJid) ?? this.list[0]
  }

  async add(options: AccountOptions): Promise<Account> {
    const existing = this.list.find((a) => a.jid === options.jid)
    if (existing) {
      // a listed account that never got connected retries on re-add
      if (existing.status !== 'connected' && existing.status !== 'connecting') {
        void existing.connect()
      }
      return existing
    }
    const account = new Account(options, {
      refreshOAuth: (target) => void this.refreshOAuth(target),
      forEachAccount: (fn) => {
        for (const entry of this.list) fn(entry)
      }
    })
    // the account joins the list only after the first successful connect:
    // keeps the login form mounted through authfail/error and drops a
    // session that never connects instead of leaving a dead entry. The
    // watcher is registered before connect so a synchronous demo connect
    // cannot slip past it.
    const off = account.connection.events.on('status', (status) => {
      if (status === 'connected') {
        off()
        this.list.push(account)
        this.applyOrder()
        this.activeJid ??= account.jid
        void saveSession(options)
      } else if (status === 'authfail' || status === 'error' || status === 'disconnected') {
        off()
        // without this a failed first connect would auto-reconnect forever
        account.disconnect()
      }
    })
    await account.connect()
    return account
  }

  // XEP-0077 in-band registration on a throwaway websocket, then the
  // caller logs in through add(). Resolves a machine-readable reason so
  // the ui can pick a locale string without importing core types.
  async register(
    jid: string,
    password: string,
    server?: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const websocketUrl = server ?? (await discoverEndpoints(jidDomain(jid))).websocket
      if (!websocketUrl) return { ok: false, reason: 'unsupported' }
      await registerAccount(websocketUrl, jid, password)
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof RegisterError ? err.reason : 'error' }
    }
  }

  // XEP-0493 oauth login, phase one: probe the server for OAUTHBEARER,
  // harvest the authorization server discovery url from the rfc 7628
  // error reply, register the client if needed and return the authorize
  // url. The pending flow is stashed in sessionStorage for the callback.
  async startOAuth(
    jid: string,
    options: {
      websocketUrl?: string | undefined
      redirectUri: string
      remember?: boolean | undefined
      untrusted?: boolean | undefined
    }
  ): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
    try {
      const websocketUrl =
        options.websocketUrl ?? (await discoverEndpoints(jidDomain(jid))).websocket
      if (!websocketUrl) return { ok: false, reason: 'unreachable' }
      const probe = await probeOauthSupport(websocketUrl, jid)
      if (!probe.supported) return { ok: false, reason: 'unsupported' }
      if (!probe.discoveryUrl) return { ok: false, reason: 'no-discovery' }
      const metadata = await fetchOAuthMetadata(probe.discoveryUrl)
      let clientId = loadOAuthClientId(metadata.issuer)
      if (!clientId) {
        clientId = await registerOAuthClient(metadata, options.redirectUri, 'Badinage')
        if (!clientId) return { ok: false, reason: 'registration' }
        saveOAuthClientId(metadata.issuer, clientId)
      }
      const { verifier, challenge } = await pkcePair()
      const state = oauthState()
      savePendingFlow({
        jid: bareJid(jid),
        websocketUrl,
        discoveryUrl: probe.discoveryUrl,
        issuer: metadata.issuer,
        clientId,
        state,
        verifier,
        redirectUri: options.redirectUri,
        remember: options.remember,
        untrusted: options.untrusted
      })
      const url = buildAuthorizeUrl(metadata, {
        clientId,
        redirectUri: options.redirectUri,
        state,
        challenge,
        scopes: pickScopes(metadata),
        loginHint: jid
      })
      return { ok: true, url }
    } catch (err) {
      return { ok: false, reason: err instanceof OAuthError ? err.code : 'error' }
    }
  }

  // XEP-0493 oauth login, phase two: the provider redirected back with a
  // code. Verify the state nonce, swap the code for tokens at the
  // recorded endpoints, then connect with the access token pinned to
  // the OAUTHBEARER mechanism.
  async completeOAuth(
    code: string,
    state: string
  ): Promise<{ ok: true; account: Account } | { ok: false; reason: string }> {
    const flow = takePendingFlow()
    if (!flow || flow.state !== state) return { ok: false, reason: 'state' }
    try {
      const metadata = await fetchOAuthMetadata(flow.discoveryUrl)
      const tokens = await exchangeCode(metadata, {
        code,
        verifier: flow.verifier,
        clientId: flow.clientId,
        redirectUri: flow.redirectUri
      })
      const account = await this.add({
        jid: flow.jid,
        password: tokens.accessToken,
        websocketUrl: flow.websocketUrl,
        oauth: true,
        remember: flow.remember,
        untrusted: flow.untrusted
      })
      saveOAuthTokens(flow.jid, {
        ...tokens,
        discoveryUrl: flow.discoveryUrl,
        clientId: flow.clientId
      })
      return { ok: true, account }
    } catch (err) {
      return { ok: false, reason: err instanceof OAuthError ? err.code : 'error' }
    }
  }

  // oauth accounts fail auth the day the access token expires. With a
  // refresh token we mint a new one and reconnect once without sending
  // the user back through the browser flow
  async refreshOAuth(account: Account): Promise<boolean> {
    const stored = loadOAuthTokens(account.jid)
    if (!stored?.refreshToken || !account.options.oauth) return false
    try {
      const metadata = await fetchOAuthMetadata(stored.discoveryUrl)
      const tokens = await refreshAccessToken(metadata, {
        refreshToken: stored.refreshToken,
        clientId: stored.clientId
      })
      saveOAuthTokens(account.jid, {
        ...tokens,
        discoveryUrl: stored.discoveryUrl,
        clientId: stored.clientId
      })
      account.options.password = tokens.accessToken
      account.connection.connect(account.jid, tokens.accessToken)
      return true
    } catch {
      clearOAuthTokens(account.jid)
      return false
    }
  }

  remove(jid: string): void {
    const account = this.list.find((a) => a.jid === jid)
    if (!account) return
    void this.teardown(account)
  }

  // Let listeners flush pending writes first, then disconnect, drop the
  // account and delete its persisted data before a late snapshot lands.
  private async teardown(account: Account): Promise<void> {
    try {
      await Promise.all(this.removeListeners.map((fn) => fn(account.jid)))
    } finally {
      account.disconnect()
      account.disposeOmemo()
      this.list = this.list.filter((a) => a !== account)
      clearSession(account.jid)
      clearOAuthTokens(account.jid)
      if (this.activeJid === account.jid) this.activeJid = this.list[0]?.jid ?? null
      const order = settings.current.accountOrder
      if (order.includes(account.jid)) {
        settings.set(
          'accountOrder',
          order.filter((entry) => entry !== account.jid)
        )
      }
    }
    await deleteAccountData(account.jid).catch((error: unknown) => {
      console.warn(
        `failed to delete local data for ${account.jid}:`,
        error instanceof Error ? error.message : String(error)
      )
    })
  }

  // move an account one step in the switcher order and persist the new
  // arrangement. ActiveJid is untouched so the view does not jump
  move(jid: string, delta: -1 | 1): void {
    const from = this.list.findIndex((a) => a.jid === jid)
    const to = from + delta
    if (from < 0 || to < 0 || to >= this.list.length) return
    const [item] = this.list.splice(from, 1)
    if (!item) return
    this.list.splice(to, 0, item)
    settings.set(
      'accountOrder',
      this.list.map((a) => a.jid)
    )
  }

  // sort the live list by the persisted preference. Unlisted jids keep
  // their arrival order at the end (sort is stable)
  private applyOrder(): void {
    const order = settings.current.accountOrder
    if (order.length === 0) return
    const rank = new Map(order.map((jid, i) => [jid, i]))
    this.list.sort((a, b) => (rank.get(a.jid) ?? order.length) - (rank.get(b.jid) ?? order.length))
  }
}

export const accounts = new AccountsStore()
