// Full local-data wipe: every IndexedDB object store plus the
// badinage-namespaced keys in web storage. DOM storage access stays in
// core/storage so this layer remains DOM-free.

import { idb } from '$lib/core/storage/idb'
import { clearScopedStorage } from '$lib/core/storage/session'

export async function wipeAllData(): Promise<void> {
  await Promise.all([idb.clear('kv'), idb.clear('messages'), idb.clear('omemo')])
  clearScopedStorage()
}
