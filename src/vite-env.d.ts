/// <reference types="vite/client" />

interface ImportMetaEnv {
  // build-time DSN for optional crash reporting. Any Sentry-API-compatible
  // server works (sentry.io, GlitchTip, Bugsink). Absent or empty disables
  // telemetry entirely: no listeners, no init, no network.
  readonly VITE_SENTRY_DSN?: string
  // deploys under a subpath set this for the build base
  readonly VITE_BASE?: string
}
