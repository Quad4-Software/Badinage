// Deployment status store. Polls the same-origin status.json on a timer.
// Browser online/offline events are DOM globals, so the shell pushes
// them in through setOffline and the store itself stays DOM-free.

import { STATUS_POLL_MS } from '$lib/constants'
import { fetchStatus, type DeploymentStatus } from '$lib/core/status'

const STATUS_URL = `${import.meta.env.BASE_URL}status.json`

class DeploymentStatusStore {
  status = $state<DeploymentStatus>({ mode: 'ok' })
  offline = $state(false)

  private started = false

  get blocking(): boolean {
    return this.status.mode === 'full' || this.status.mode === 'outage'
  }

  start(): void {
    if (this.started) return
    this.started = true
    void this.refresh()
    setInterval(() => void this.refresh(), STATUS_POLL_MS)
  }

  // reconnecting is the best moment to re-check the status file
  setOffline(value: boolean): void {
    const was = this.offline
    this.offline = value
    if (was && !value) void this.refresh()
  }

  private async refresh(): Promise<void> {
    if (this.offline) return
    const next = await fetchStatus(STATUS_URL)
    if (next) this.status = next
  }
}

export const deployment = new DeploymentStatusStore()
