// OMEMO service lifecycle for Account: in-flight init is cached per
// account so concurrent callers await one creation, failures are not
// cached, and untrusted sessions keep key material in memory only.

import { InMemoryOmemoStore, OmemoService } from '$lib/core/omemo'
import { InMemoryTrustStore } from '$lib/core/omemo/trust'
import { settings } from '$lib/state/settings.svelte'

import type { Account } from '../accounts.svelte'

interface OmemoInit {
  promise: Promise<OmemoService | undefined>
  error: string | undefined
}

const pending = new WeakMap<Account, OmemoInit>()

export async function initOmemoService(account: Account): Promise<void> {
  account.omemoError = undefined
  let entry = pending.get(account)
  if (!entry) {
    const init: OmemoInit = { promise: Promise.resolve(undefined), error: undefined }
    init.promise = OmemoService.create({
      connection: account.connection,
      accountJid: account.jid,
      blindTrust: settings.current.omemoBlindTrust,
      // untrusted devices keep key material and trust decisions in memory
      ...(account.options.untrusted
        ? { omemoStore: new InMemoryOmemoStore(), trustStore: new InMemoryTrustStore() }
        : {})
    }).catch((err: unknown) => {
      init.error = err instanceof Error ? err.message : String(err)
      console.warn('omemo init failed:', init.error)
      return undefined
    })
    entry = init
    pending.set(account, entry)
  }
  account.omemo = await entry.promise
  account.omemoError = entry.error
  if (!account.omemo) {
    // do not cache a failed init: the next connect retries from scratch
    pending.delete(account)
  }
  await account.omemo?.publishOwn().catch((err: unknown) => {
    // a failed republish still leaves a working account
    console.warn('omemo publish failed:', err instanceof Error ? err.message : String(err))
  })
}

export function pendingOmemo(account: Account): Promise<OmemoService | undefined> | undefined {
  return pending.get(account)?.promise
}

// kill the crypto worker on removal
export function disposeOmemoService(account: Account): void {
  void pending.get(account)?.promise.then((service) => service?.dispose())
  account.omemo = undefined
  pending.delete(account)
}
