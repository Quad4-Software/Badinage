// Browser-backed media deps for CallEngine. Isolated so the engine and
// every consumer stay testable: headless environments resolve support
// as false and never touch navigator or RTCPeerConnection.

import type { CallMediaDeps } from './engine'

export function callsSupported(): boolean {
  return (
    typeof RTCPeerConnection !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

export function browserMediaDeps(): CallMediaDeps {
  return {
    peer: (config) => new RTCPeerConnection(config),
    media: (constraints) => navigator.mediaDevices.getUserMedia(constraints)
  }
}
