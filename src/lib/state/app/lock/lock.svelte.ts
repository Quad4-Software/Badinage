// App lock state: gates the whole shell behind a passphrase. The KEK
// lives in core module memory, so locking is just dropping it and
// reloading - every sealed record and session blob stays at rest.

import {
  changePassphrase,
  disableLock,
  enableLock,
  lockConfig,
  unlockLock
} from '$lib/core/storage/lock'
import { setKek } from '$lib/core/storage/crypto'

class AppLockStore {
  // config exists in kv - the passphrase flow is armed
  enabled = $state(false)
  // enabled and no KEK in memory - the gate is up
  locked = $state(false)
  // resolved once init has read the config so App waits before booting
  ready = $state(false)

  async init(): Promise<void> {
    this.enabled = (await lockConfig()) !== undefined
    this.locked = this.enabled
    this.ready = true
  }

  async unlock(passphrase: string): Promise<boolean> {
    const ok = await unlockLock(passphrase)
    if (ok) this.locked = false
    return ok
  }

  async enable(passphrase: string): Promise<void> {
    await enableLock(passphrase)
    this.enabled = true
    this.locked = false
  }

  async disable(): Promise<void> {
    await disableLock()
    this.enabled = false
  }

  async changePassphrase(current: string, next: string): Promise<boolean> {
    return changePassphrase(current, next)
  }

  // drop the KEK and raise the gate. Callers reload right after: the
  // reload is the reliable memory wipe since decrypted records and
  // in-memory sessions die with the page while sealed blobs persist
  // in sessionStorage for the unlock path
  seal(): void {
    setKek(undefined)
    this.locked = true
  }
}

export const appLock = new AppLockStore()
