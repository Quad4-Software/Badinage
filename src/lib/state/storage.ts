// Full local-data wipe: every IndexedDB object store plus the
// badinage-namespaced keys in web storage. DOM storage access stays in
// core/storage so this layer remains DOM-free.

import { idb, IDB_STORES } from '$lib/core/storage/idb'
import { scopedKey } from '$lib/core/storage/keys'
import { clearScopedStorage } from '$lib/core/storage/session'

export async function wipeAllData(): Promise<void> {
  await Promise.all(IDB_STORES.map((store) => idb.clear(store)))
  clearScopedStorage()
}

// Delete every record namespaced to one account: message snapshots, OMEMO
// key material and trust records, and the wrap keys in kv. Called on
// account removal so the confirmed 'local data deleted' copy is true.
export async function deleteAccountData(accountJid: string): Promise<void> {
  const prefix = scopedKey(accountJid)
  for (const store of IDB_STORES) {
    const keys = await idb.keys(store)
    await Promise.all(
      keys
        .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
        .map((key) => idb.del(store, key))
    )
  }
}
