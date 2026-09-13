// Optional crash reporting through a Sentry-compatible endpoint.
//
// The ingest endpoint defaults to DEFAULT_TELEMETRY_DSN and can be
// overridden at build time through VITE_SENTRY_DSN. Any server that
// speaks the Sentry envelope API works: sentry.io, or a self-hosted
// GlitchTip or Bugsink instance. Setting the env to 'off' disables the
// integration for that build. Reporting is opt-in: until the user
// enables it the SDK is never initialized, so no listeners attach and
// no network traffic is generated at all.

import type { Breadcrumb, ErrorEvent } from '@sentry/browser'
import {
  browserTracingIntegration,
  captureException,
  init as sentryInit,
  withScope
} from '@sentry/browser'

import { DEFAULT_TELEMETRY_DSN } from '$lib/constants'

const ENV_DSN = import.meta.env.VITE_SENTRY_DSN?.trim()
const DSN = ENV_DSN === 'off' ? '' : ENV_DSN || DEFAULT_TELEMETRY_DSN

// keeps sampled traces cheap. Error events are always captured
const TRACES_SAMPLE_RATE = 0.1

// matches anything JID- or email-shaped: a run of address characters
// around an @. The local part stops at path/query/scheme separators so
// urls keep their origin, while the domain part may still swallow a
// trailing /resource (a full JID gets redacted whole).
const ADDRESS_RE = /[^\s"'<>@/:;=?#[\](),]+@[^\s"'<>@:;=?#[\](),]+/g

const REDACTED = '[redacted-address]'

// a breadcrumb whose data carries any of these keys almost certainly
// holds stanza XML or message content. Drop it outright
const SENSITIVE_DATA_KEYS = new Set([
  'stanza',
  'xml',
  'body',
  'message',
  'jid',
  'from',
  'to',
  'password',
  'token',
  'secret'
])

// raw stanzas logged to the console open with an element name
const STANZA_RE = /^\s*<(message|presence|iq|stream:\w+)\b/

// request headers that carry credentials verbatim
const SENSITIVE_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization'])

// user-facing opt-in. When off the SDK is never initialized and the
// beforeSend gates stay armed for anything queued before a toggle off
let reportingEnabled = false
let initialized = false

// Replaces JIDs and email-shaped addresses with a placeholder. Runs of
// text without an @ pass through untouched.
export function scrubText(text: string): string {
  return text.replace(ADDRESS_RE, REDACTED)
}

// Removes credentials, query string and fragment from a url, then
// address-scrubs what remains. Unparseable urls get the same treatment
// by hand.
export function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return scrubText(url.toString())
  } catch {
    return scrubText(raw.split(/[?#]/)[0] ?? raw)
  }
}

// True when a breadcrumb data object carries stanza- or message-like
// fields that should never leave the device.
export function hasSensitiveData(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false
  return Object.keys(data).some((key) => SENSITIVE_DATA_KEYS.has(key.toLowerCase()))
}

// Scrubs a breadcrumb in place of the default beforeBreadcrumb, or
// returns null to drop it when it looks like it carries stanza data.
export function filterBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (hasSensitiveData(crumb.data)) return null
  const out = { ...crumb }
  if (typeof out.message === 'string') {
    if (STANZA_RE.test(out.message)) return null
    out.message = scrubText(out.message)
  }
  if (out.data) {
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(out.data)) {
      if (typeof value !== 'string') {
        data[key] = value
      } else if (/url/i.test(key)) {
        data[key] = scrubUrl(value)
      } else {
        data[key] = scrubText(value)
      }
    }
    out.data = data
  }
  return out
}

// Removes anything that could identify a contact or carry message
// content from an outgoing error event.
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const out: ErrorEvent = { ...event }
  if (out.message) out.message = scrubText(out.message)
  if (out.logentry?.message) {
    out.logentry = { ...out.logentry, message: scrubText(out.logentry.message) }
  }
  if (out.exception?.values) {
    out.exception = {
      values: out.exception.values.map((ex) =>
        ex.value === undefined ? { ...ex } : { ...ex, value: scrubText(ex.value) }
      )
    }
  }
  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs
      .map((crumb) => filterBreadcrumb(crumb))
      .filter((crumb) => crumb !== null)
  }
  if (out.request) {
    const request = { ...out.request }
    if (request.url) request.url = scrubUrl(request.url)
    if (request.headers) {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) continue
        headers[key] = key.toLowerCase() === 'referer' ? scrubUrl(value) : scrubText(value)
      }
      request.headers = headers
    }
    // request bodies, cookies and query params may hold payloads
    delete request.data
    delete request.cookies
    delete request.query_string
    out.request = request
  }
  // we never attach user context. Make sure nothing else did either
  delete out.user
  return out
}

// Flips the runtime opt-in. Enabling lazily initializes the SDK on the
// spot so the toggle takes effect without a reload. Disabling drops
// every event in the beforeSend gates and makes reportError a no-op.
export function setTelemetryEnabled(enabled: boolean): void {
  reportingEnabled = enabled
  if (enabled) initTelemetry()
}

// Captures an error explicitly, e.g. from a svelte:boundary onerror
// handler where the SDK global handlers cannot see it. Global error and
// unhandledrejection events are already covered by the SDK defaults.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized || !reportingEnabled) return
  withScope((scope) => {
    for (const [key, value] of Object.entries(context ?? {})) {
      scope.setExtra(key, typeof value === 'string' ? scrubText(value) : value)
    }
    captureException(error)
  })
}

// Attaches the SDK global handlers and tracing. Runs lazily the first
// time reporting is enabled. Does nothing while opted out or without a
// DSN.
function initTelemetry(): void {
  if (!DSN || !reportingEnabled || initialized) return
  initialized = true
  sentryInit({
    dsn: DSN,
    sendDefaultPii: false,
    integrations: [browserTracingIntegration()],
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // benign browser noise, not app bugs
    ignoreErrors: [
      'ResizeObserver loop completed with undelivered notifications',
      'ResizeObserver loop limit exceeded',
      /network request failed|failed to fetch|load failed/i
    ],
    // errors thrown inside browser extensions are not ours
    denyUrls: [/^(chrome|moz|ms-browser|safari-web)-extension:/],
    beforeSend(event) {
      if (!reportingEnabled) return null
      return scrubEvent(event)
    },
    beforeBreadcrumb(crumb) {
      if (!reportingEnabled) return null
      return filterBreadcrumb(crumb)
    },
    // transaction envelopes bypass beforeSend, so the opt-out needs its
    // own gate here as well
    beforeSendTransaction(event) {
      if (!reportingEnabled) return null
      if (event.transaction) event.transaction = scrubText(event.transaction)
      return event
    }
  })
}
