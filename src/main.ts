import { mount } from 'svelte'

import { initTelemetry, setTelemetryEnabled } from '$lib/core/telemetry'
import { settings } from '$lib/state/settings.svelte'

import App from './App.svelte'
import './app.css'

// apply the persisted opt-out before the SDK attaches its listeners;
// without a DSN this is a no-op
setTelemetryEnabled(settings.current.crashReporting)
initTelemetry()

const target = document.getElementById('app')
if (!target) throw new Error('missing #app element')

export default mount(App, { target })
