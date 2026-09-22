import { mount } from 'svelte'

import { installPerfHook, startPerfMonitor } from '$lib/core/perf'
import { setTelemetryEnabled } from '$lib/core/telemetry'
import { settings } from '$lib/state/settings.svelte'

import App from './App.svelte'
import './app.css'

// apply the persisted opt-in before the app mounts. Enabling lazily
// initializes the SDK, disabling leaves it inert with no listeners
setTelemetryEnabled(settings.current.crashReporting)

// the monitor runs everywhere: budgets watched in dev are the same ones
// the e2e perf spec asserts. The debug hook stays behind the e2e flag
// so production builds expose no snapshot surface
const perf = startPerfMonitor()
if (import.meta.env.DEV || import.meta.env.VITE_E2E) installPerfHook(perf)

const target = document.getElementById('app')
if (!target) throw new Error('missing #app element')

export default mount(App, { target })
