import { IDB_NAME, IDB_VERSION } from '$lib/constants'

const STORES = ['kv', 'messages', 'omemo'] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | undefined

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name)
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(store, mode).objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
  )
}

export const idb = {
  get: <T>(store: StoreName, key: string) =>
    tx(store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  set: (store: StoreName, key: string, value: unknown) =>
    tx(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: StoreName, key: string) => tx(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: StoreName) => tx(store, 'readonly', (s) => s.getAllKeys()),
  clear: (store: StoreName) => tx(store, 'readwrite', (s) => s.clear())
}
