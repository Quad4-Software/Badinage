import { mount } from 'svelte'

import { setTelemetryEnabled } from '$lib/core/telemetry'
import { settings } from '$lib/state/settings.svelte'

import App from './App.svelte'
import './app.css'

// apply the persisted opt-in before the app mounts; enabling lazily
// initializes the SDK, disabling leaves it inert with no listeners
setTelemetryEnabled(settings.current.crashReporting)

const target = document.getElementById('app')
if (!target) throw new Error('missing #app element')

export default mount(App, { target })
