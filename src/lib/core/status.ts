// Deployment status contract. A static client cannot be reconfigured
// without a rebuild, so ops publishes a status.json next to the app and
// the client polls it. 'soft' shows a dismissible banner, 'full' and
// 'outage' take over the screen. Removing the file (or serving the spa
// fallback in its place) clears the status back to 'ok'.

type StatusMode = 'ok' | 'soft' | 'full' | 'outage'

export interface DeploymentStatus {
  mode: StatusMode
  // optional operator-provided detail shown under the title
  message?: string
  // ISO 8601 timestamp, shown as the expected end of the window
  until?: string
}

const MODES: readonly StatusMode[] = ['ok', 'soft', 'full', 'outage']

const OK: DeploymentStatus = { mode: 'ok' }

// unknown modes and malformed payloads degrade to 'ok' rather than
// blocking the app on an ops typo
export function parseStatus(payload: unknown): DeploymentStatus {
  if (typeof payload !== 'object' || payload === null) return OK
  const { mode, message, until } = payload as Record<string, unknown>
  if (typeof mode !== 'string' || !MODES.includes(mode as StatusMode)) return OK
  const status: DeploymentStatus = { mode: mode as StatusMode }
  if (typeof message === 'string' && message !== '') status.message = message
  if (typeof until === 'string' && !Number.isNaN(Date.parse(until))) status.until = until
  return status
}

// returns null only when the fetch itself fails (offline, origin
// unreachable): the caller then keeps the previous status instead of
// flapping a maintenance page during a momentary network drop. Any
// response, including a 404 or the spa fallback html, parses as 'ok'
// so deleting status.json ends a window
export async function fetchStatus(url: string): Promise<DeploymentStatus | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    return parseStatus(await response.json().catch(() => null))
  } catch {
    return null
  }
}
